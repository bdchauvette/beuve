import { describe } from 'vitest';

import type { ImpactSourceFile } from '#internal/impact/impact-input.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

function noLines(): ImpactSourceFile['changedLines'] {
  return { base: [], head: [] };
}

describe('createImpactWorker with the real worker', () => {
  test('round-trips blob texts and changed ranges to a report', async ({
    expect,
    createRunner,
    signal,
  }) => {
    const runner = createRunner();
    const source: ImpactSourceFile = {
      path: 'src/a.ts',
      baseText: 'export function f(a: number): number {\n  return a;\n}\n',
      headText:
        'export function f(a: number): number {\n  if (a > 1 && a < 5) {\n    return 1;\n  }\n  return a;\n}\n',
      changedLines: { base: [], head: [{ start: 2, end: 4 }] },
    };
    const result = await runner.run(
      [source, { path: 'notes.md', baseText: '# a', headText: '# b', changedLines: noLines() }],
      signal,
    );
    expect(result.ok).toBe(true);
    const report = okValueFrom(result);
    expect(report.files[0]).toMatchObject({
      status: 'analyzed',
      path: 'src/a.ts',
      functions: [{ name: 'f', change: 'modified', inDiff: true }],
    });
    expect(report.files[1]).toMatchObject({ status: 'skipped', reason: 'unsupported-language' });
    expect(report.totals.modified).toBe(1);
  });
});

function source(path: string): ImpactSourceFile[] {
  return [{ path, baseText: undefined, headText: '', changedLines: noLines() }];
}

describe('createImpactWorker with a scripted worker', () => {
  test('serves queued runs in order', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    const results = await Promise.all([
      runner.run(source('delay-30'), signal),
      runner.run(source('a'), signal),
      runner.run(source('b'), signal),
    ]);
    expect(results.map((result) => result.ok)).toStrictEqual([true, true, true]);
  });

  test('fails the run that crashed the worker and serves the next on a fresh one', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    const first = await runner.run(source('a'), signal);
    expect(first.ok).toBe(true);
    const crashed = await runner.run(source('crash'), signal);
    expect(crashed).toMatchObject({ ok: false, error: { kind: 'worker-failed' } });
    const after = await runner.run(source('a'), signal);
    expect(after.ok).toBe(true);
  });

  test('reports an error the worker caught without restarting it', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    await expect(runner.run(source('fail'), signal)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'worker-failed', message: 'scripted failure' },
    });
    const after = await runner.run(source('a'), signal);
    expect(after.ok).toBe(true);
  });

  test('fails when the worker script cannot start', async ({ expect, createRunner, signal }) => {
    const runner = createRunner(new URL('no-such-worker.ts', import.meta.url));
    await expect(runner.run(source('a'), signal)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'worker-failed' },
    });
  });

  test('cancels a running run by restarting the worker, and keeps queued runs', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    const controller = new AbortController();
    const hung = runner.run(source('hang'), controller.signal);
    const queued = runner.run(source('a'), signal);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await expect(hung).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    const served = await queued;
    expect(served.ok).toBe(true);
  });

  test('cancels a queued run without starting it, and refuses an already aborted signal', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    const controller = new AbortController();
    const first = runner.run(source('delay-50'), signal);
    const second = runner.run(source('hang'), controller.signal);
    controller.abort();
    await expect(second).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    const served = await first;
    expect(served.ok).toBe(true);
    await expect(runner.run(source('a'), AbortSignal.abort())).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });

  test('lets go of a settled run’s signal: aborting it later cancels nothing', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    const finished = new AbortController();
    await expect(runner.run(source('a'), finished.signal)).resolves.toMatchObject({ ok: true });
    const running = runner.run(source('delay-30'), signal);
    finished.abort();
    await expect(running).resolves.toMatchObject({ ok: true });
  });

  test('cancels everything pending on dispose and refuses later runs', async ({
    expect,
    createRunner,
    scriptedWorkerUrl,
    signal,
  }) => {
    const runner = createRunner(scriptedWorkerUrl);
    const hung = runner.run(source('hang'), signal);
    const queued = runner.run(source('a'), signal);
    await new Promise((resolve) => setTimeout(resolve, 50));
    runner.dispose();
    await expect(hung).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    await expect(queued).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    await expect(runner.run(source('a'), signal)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});
