import { afterEach, describe, expect, it } from 'vitest';

import type { ImpactSourceFile } from '#internal/impact/impact-input.ts';
import { createLogger } from '#pkg/logger/create-logger.ts';

import { createImpactWorker } from './create-impact-worker.ts';
import type { ImpactRunner } from './create-impact-worker.ts';

const noLines = { base: [], head: [] };
const scripted = new URL('testing/scripted-impact-worker.ts', import.meta.url);
const logger = createLogger('test', { sink: (): void => undefined });

describe('createImpactWorker with the real worker', () => {
  let runner: ImpactRunner | undefined;
  afterEach(() => {
    runner?.dispose();
  });

  it('round-trips blob texts and changed ranges to a report', async () => {
    runner = createImpactWorker({ logger });
    const source: ImpactSourceFile = {
      path: 'src/a.ts',
      baseText: 'export function f(a: number): number {\n  return a;\n}\n',
      headText:
        'export function f(a: number): number {\n  if (a > 1 && a < 5) {\n    return 1;\n  }\n  return a;\n}\n',
      changedLines: { base: [], head: [{ start: 2, end: 4 }] },
    };
    const result = await runner.run([
      source,
      { path: 'notes.md', baseText: '# a', headText: '# b', changedLines: noLines },
    ]);
    expect(result.ok).toBe(true);
    const report = result.ok ? result.value : undefined;
    expect(report?.files[0]).toMatchObject({
      status: 'analyzed',
      path: 'src/a.ts',
      functions: [{ name: 'f', change: 'modified', inDiff: true }],
    });
    expect(report?.files[1]).toMatchObject({ status: 'skipped', reason: 'unsupported-language' });
    expect(report?.totals.modified).toBe(1);
  });
});

function source(path: string): ImpactSourceFile[] {
  return [{ path, baseText: undefined, headText: '', changedLines: noLines }];
}

describe('createImpactWorker with a scripted worker', () => {
  let runner: ImpactRunner;
  afterEach(() => {
    runner.dispose();
  });

  it('serves queued runs in order', async () => {
    runner = createImpactWorker({ logger, workerUrl: scripted });
    const results = await Promise.all([
      runner.run(source('delay-30')),
      runner.run(source('a')),
      runner.run(source('b')),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
  });

  it('fails the run that crashed the worker and serves the next on a fresh one', async () => {
    runner = createImpactWorker({ logger, workerUrl: scripted });
    const first = await runner.run(source('a'));
    expect(first.ok).toBe(true);
    const crashed = await runner.run(source('crash'));
    expect(crashed).toMatchObject({ ok: false, error: { kind: 'worker-failed' } });
    const after = await runner.run(source('a'));
    expect(after.ok).toBe(true);
  });

  it('reports an error the worker caught without restarting it', async () => {
    runner = createImpactWorker({ logger, workerUrl: scripted });
    expect(await runner.run(source('fail'))).toEqual({
      ok: false,
      error: { kind: 'worker-failed', message: 'scripted failure' },
    });
    const after = await runner.run(source('a'));
    expect(after.ok).toBe(true);
  });

  it('fails when the worker script cannot start', async () => {
    runner = createImpactWorker({
      logger,
      workerUrl: new URL('no-such-worker.ts', import.meta.url),
    });
    expect(await runner.run(source('a'))).toMatchObject({
      ok: false,
      error: { kind: 'worker-failed' },
    });
  });

  it('cancels a running run by restarting the worker, and keeps queued runs', async () => {
    runner = createImpactWorker({ logger, workerUrl: scripted });
    const controller = new AbortController();
    const hung = runner.run(source('hang'), controller.signal);
    const queued = runner.run(source('a'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    expect(await hung).toEqual({ ok: false, error: { kind: 'cancelled' } });
    const served = await queued;
    expect(served.ok).toBe(true);
  });

  it('cancels a queued run without starting it, and refuses an already aborted signal', async () => {
    runner = createImpactWorker({ logger, workerUrl: scripted });
    const controller = new AbortController();
    const first = runner.run(source('delay-50'));
    const second = runner.run(source('hang'), controller.signal);
    controller.abort();
    expect(await second).toEqual({ ok: false, error: { kind: 'cancelled' } });
    const served = await first;
    expect(served.ok).toBe(true);
    expect(await runner.run(source('a'), AbortSignal.abort())).toEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });

  it('cancels everything pending on dispose and refuses later runs', async () => {
    runner = createImpactWorker({ logger, workerUrl: scripted });
    const hung = runner.run(source('hang'));
    const queued = runner.run(source('a'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    runner.dispose();
    expect(await hung).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(await queued).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(await runner.run(source('a'))).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});
