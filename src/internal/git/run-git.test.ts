import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { createLogger } from '#x/log/create-logger.ts';

import { runGit } from './run-git.ts';
import { test } from './testing/test.ts';

describe('runGit', () => {
  test('returns stdout with quotepath off', async ({ expect, repo, signal }) => {
    repo.write('ünï code.txt', 'x');
    await repo.commit('first');
    const result = await runGit({
      policy: { kind: 'read' },
      cwd: repo.directory,
      args: ['ls-files'],
      signal,
    });
    expect(result).toStrictEqual({ ok: true, value: 'ünï code.txt\n' });
  });

  test('classifies a directory outside any repository', async ({ expect, repo, signal }) => {
    const outside = repo.scratch();
    const result = await runGit({
      policy: { kind: 'read' },
      cwd: outside,
      args: ['status'],
      signal,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-a-repository', path: outside } });
  });

  test('classifies a missing cwd and a missing git binary', async ({ expect, repo, signal }) => {
    const missing = path.join(repo.scratch(), 'nope');
    await expect(
      runGit({ policy: { kind: 'read' }, cwd: missing, args: ['status'], signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-a-repository' },
    });
    await expect(
      runGit({
        policy: { kind: 'read' },
        cwd: repo.directory,
        args: ['status'],
        gitBinary: '/nonexistent/git',
        signal,
      }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'git-not-found', gitBinary: '/nonexistent/git' },
    });
  });

  test('reports failures with exit code and stderr', async ({ expect, repo, signal }) => {
    const result = await runGit({
      policy: { kind: 'read' },
      cwd: repo.directory,
      args: ['cat-file', '-t', 'deadbeef'],
      signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'command-failed',
        exitCode: 128,
        stderr: expect.stringContaining('deadbeef') as unknown,
      },
    });
  });

  test('kills git when its signal aborts', async ({ expect, repo, signal }) => {
    const slow = path.join(repo.scratch(), 'slow-git');
    writeFileSync(slow, '#!/bin/sh\nsleep 5\n');
    chmodSync(slow, 0o755);
    const soon = AbortSignal.any([signal, AbortSignal.timeout(100)]);
    await expect(
      runGit({
        policy: { kind: 'read' },
        cwd: repo.directory,
        args: ['status'],
        gitBinary: slow,
        signal: soon,
      }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'aborted', args: ['status'] } });
  });

  test('times out slow commands and caps output', async ({ expect, repo, signal }) => {
    const slow = path.join(repo.scratch(), 'slow-git');
    writeFileSync(slow, '#!/bin/sh\nsleep 5\n');
    chmodSync(slow, 0o755);
    await expect(
      runGit({
        policy: { kind: 'read' },
        cwd: repo.directory,
        args: ['status'],
        gitBinary: slow,
        timeout: Temporal.Duration.from({ milliseconds: 100 }),
        signal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 100 }) },
    });

    repo.write('big.txt', 'x'.repeat(10_000));
    await repo.commit('big');
    await expect(
      runGit({
        policy: { kind: 'read' },
        cwd: repo.directory,
        args: ['show', 'HEAD:big.txt'],
        maxBufferBytes: 100,
        signal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'output-too-large', maxBufferBytes: 100 },
    });
  });

  test('rejects relative directories and NUL bytes before spawning', async ({
    expect,
    repo,
    signal,
  }) => {
    await expect(
      runGit({ policy: { kind: 'read' }, cwd: 'relative', args: ['status'], signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(
      runGit({ policy: { kind: 'read' }, cwd: repo.directory, args: ['log', 'a\0b'], signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument', reason: 'contains a NUL byte' },
    });
  });

  // Sets process.env, which every git process spawned meanwhile would inherit.
  test(
    'ignores inherited GIT_* variables that would redirect git',
    { concurrent: false },
    async ({ expect, repo, repositories, signal }) => {
      const other = await repositories.create();
      const saved = process.env['GIT_DIR'];
      try {
        process.env['GIT_DIR'] = path.join(other.directory, '.git');
        const result = await runGit({
          policy: { kind: 'read' },
          cwd: repo.directory,
          args: ['rev-parse', '--show-toplevel'],
          signal,
        });
        expect(result).toStrictEqual({ ok: true, value: `${repo.directory}\n` });
      } finally {
        if (saved === undefined) {
          delete process.env['GIT_DIR'];
        } else {
          process.env['GIT_DIR'] = saved;
        }
      }
    },
  );

  test('disables repository-configured fsmonitor commands', async ({ expect, repo, signal }) => {
    const marker = path.join(repo.scratch(), 'fsmonitor-ran');
    const hook = path.join(repo.scratch(), 'fsmonitor');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(hook, 0o755);
    repo.write('a.txt', 'a');
    await repo.commit('a');
    await repo.git('config', 'core.fsmonitor', hook);
    await runGit({
      policy: { kind: 'read' },
      cwd: repo.directory,
      args: ['status', '--porcelain'],
      signal,
    });
    expect(existsSync(marker)).toBe(false);
  });

  test('logs each invocation at debug level', async ({ expect, repo, signal }) => {
    const lines: string[] = [];
    const logger = createLogger('git', {
      level: 'debug',
      sink: (line): void => {
        lines.push(line);
      },
    });
    await runGit({
      policy: { kind: 'read' },
      cwd: repo.directory,
      args: ['status'],
      logger,
      signal,
    });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      message: 'git',
      args: ['status'],
      exitCode: 0,
    });
  });
});
