import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { readShellEnvironment } from './read-shell-environment.ts';

/**
 * A stand-in for the reviewer's shell: like `sh -i -l -c COMMAND` it runs its last argument,
 * after a banner and with `CHECKOUT_CWD` set from where it started.
 */
async function fakeShell(script: FakeShellScript): Promise<string> {
  const file = path.join(script.directory, 'fake-shell');
  await writeFile(file, `#!/bin/sh\n${script.body}\n`, { mode: 0o755 });
  return file;
}

interface FakeShellScript {
  readonly directory: string;
  readonly body: string;
}

function runsItsCommand(): string {
  return 'echo "Welcome back!"\nexport CHECKOUT_CWD="$(pwd -P)"\neval "$4"';
}

/** The variables a read gave, or a marker that it failed. */
function variablesOf(
  result: Awaited<ReturnType<typeof readShellEnvironment>>,
): Record<string, string> {
  if (result.ok) {
    return result.value;
  }
  return { failed: 'yes' };
}

describe('readShellEnvironment', () => {
  test('reads the environment the shell gives, in the directory it was started in', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const shell = await fakeShell({ directory: tempDir, body: runsItsCommand() });
    const home = path.join(tempDir, 'home');
    await mkdir(home);
    const result = await readShellEnvironment({
      shell,
      nodeCommand: process.execPath,
      cwd: home,
      env: { PATH: process.env['PATH'], MARKER: 'kept' },
      timeout: Temporal.Duration.from({ seconds: 20 }),
      signal,
    });
    expect(result).toMatchObject({ ok: true, value: { MARKER: 'kept' } });
    const variables = variablesOf(result);
    expect(variables['CHECKOUT_CWD']).toMatch(/home$/u);
  });

  test('keeps Electron and Node steering variables out of the shell, and its own marker out of the result', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const shell = await fakeShell({ directory: tempDir, body: runsItsCommand() });
    const result = await readShellEnvironment({
      shell,
      nodeCommand: process.execPath,
      cwd: tempDir,
      env: {
        PATH: process.env['PATH'],
        ELECTRON_RUN_AS_NODE: '1',
        CHROME_DESKTOP: 'x.desktop',
        NODE_OPTIONS: '--no-warnings',
      },
      timeout: Temporal.Duration.from({ seconds: 20 }),
      signal,
    });
    const variables = variablesOf(result);
    expect(Object.keys(variables)).not.toContain('ELECTRON_RUN_AS_NODE');
    expect(Object.keys(variables)).not.toContain('CHROME_DESKTOP');
    expect(Object.keys(variables)).not.toContain('NODE_OPTIONS');
    expect(Object.keys(variables)).not.toContain('BEUVE_RESOLVING_ENVIRONMENT');
  });

  test('gives up, killing the shell, when the deadline passes', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const shell = await fakeShell({ directory: tempDir, body: 'exec sleep 30' });
    const result = await readShellEnvironment({
      shell,
      nodeCommand: process.execPath,
      cwd: tempDir,
      env: { PATH: process.env['PATH'] },
      timeout: Temporal.Duration.from({ milliseconds: 200 }),
      signal,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'timed-out' } });
  });

  test('says so when the shell fails, with the end of what it wrote', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const shell = await fakeShell({
      directory: tempDir,
      body: 'echo "rc file broke" >&2\nexit 3',
    });
    const result = await readShellEnvironment({
      shell,
      nodeCommand: process.execPath,
      cwd: tempDir,
      env: { PATH: process.env['PATH'] },
      timeout: Temporal.Duration.from({ seconds: 20 }),
      signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'failed',
        code: 3,
        stderr: expect.stringContaining('rc file broke') as string,
      },
    });
  });

  test('says so when there is no shell to start', async ({ expect, tempDir, signal }) => {
    const result = await readShellEnvironment({
      shell: path.join(tempDir, 'no-such-shell'),
      nodeCommand: process.execPath,
      cwd: tempDir,
      env: {},
      timeout: Temporal.Duration.from({ seconds: 20 }),
      signal,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-started' } });
  });

  test('reports a cancellation as one, not as a timeout', async ({ expect, tempDir }) => {
    const shell = await fakeShell({ directory: tempDir, body: 'exec sleep 30' });
    const controller = new AbortController();
    const pending = readShellEnvironment({
      shell,
      nodeCommand: process.execPath,
      cwd: tempDir,
      env: { PATH: process.env['PATH'] },
      timeout: Temporal.Duration.from({ seconds: 20 }),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'cancelled' } });
  });
});
