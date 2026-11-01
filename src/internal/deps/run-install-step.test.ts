import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { runInstallStep } from './run-install-step.ts';
import { test } from './testing/test.ts';
import { writeFakeTool } from './testing/write-fake-tool.ts';

describe('runInstallStep (ADR 0089)', () => {
  test('runs without a shell in its directory with exactly its environment', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const checkout = path.join(tempDir, 'checkout');
    mkdirSync(path.join(checkout, 'web'), { recursive: true });
    const fake = writeFakeTool(
      { directory: tempDir, name: 'pnpm' },
      { creates: ['node_modules/.installed'], prints: 'done\n' },
    );
    const output: string[] = [];
    const ran = await runInstallStep({
      step: {
        label: 'pnpm',
        cwd: 'web',
        argv: [fake.command, 'install', '$HOME;rm -rf'],
        env: { ONLY: 'this' },
      },
      checkout,
      signal,
      onOutput: (chunk) => {
        output.push(chunk);
      },
    });
    expect(ran).toStrictEqual({ ok: true, value: undefined });
    expect(existsSync(path.join(checkout, 'web/node_modules/.installed'))).toBe(true);
    expect(output.join('')).toBe('done\n');
    const [call] = fake.calls();
    expect(call?.argv).toStrictEqual(['install', '$HOME;rm -rf']);
    expect(call?.cwd).toBe(path.join(checkout, 'web'));
    expect(call?.env['ONLY']).toBe('this');
    expect(call?.env['HOME']).toBeUndefined();
  });

  test('reports a non-zero exit and a missing executable', async ({ expect, tempDir, signal }) => {
    const fake = writeFakeTool({ directory: tempDir, name: 'npm' }, { exitCode: 3 });
    const step = { label: 'npm', cwd: '', env: {} };
    await expect(
      runInstallStep({
        step: { ...step, argv: [fake.command, 'ci'] },
        checkout: tempDir,
        signal,
      }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'exited', code: 3, signal: undefined },
    });
    await expect(
      runInstallStep({
        step: { ...step, argv: [path.join(tempDir, 'missing')] },
        checkout: tempDir,
        signal,
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not-started' } });
  });

  test('never starts in a directory that leaves the checkout through a link', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const checkout = path.join(tempDir, 'checkout');
    mkdirSync(checkout);
    symlinkSync(tempDir, path.join(checkout, 'out'));
    const fake = writeFakeTool({ directory: tempDir, name: 'tool' });
    await expect(
      runInstallStep({
        step: { label: 'x', cwd: 'out', argv: [fake.command], env: {} },
        checkout,
        signal,
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not-started' } });
    expect(fake.calls()).toStrictEqual([]);
  });

  test('a cancel kills the whole process group, SIGKILL after the grace', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const fake = writeFakeTool({ directory: tempDir, name: 'hang' }, { hangs: true });
    const controller = new AbortController();
    const stop = AbortSignal.any([signal, controller.signal]);
    const running = runInstallStep({
      step: { label: 'hang', cwd: '', argv: [fake.command], env: {} },
      checkout: tempDir,
      signal: stop,
      killGrace: Temporal.Duration.from({ milliseconds: 200 }),
      onOutput: (chunk) => {
        if (chunk.includes('waiting')) {
          controller.abort('cancelled');
        }
      },
    });
    await expect(running).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'stopped', reason: 'cancelled' },
    });
    const [grandchild] = fake.grandchildren();
    expect(grandchild).toBeTypeOf('number');
    expect(isAlive(grandchild ?? 0)).toBe(false);
  });
});
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
