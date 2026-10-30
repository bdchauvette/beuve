import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { createLogger } from '#x/log/create-logger.ts';

import { runGit } from './run-git.ts';
import { test } from './testing/test.ts';

describe('runGit', () => {
  test('returns stdout with quotepath off', async ({ expect, repo }) => {
    repo.write('ünï code.txt', 'x');
    await repo.commit('first');
    const result = await runGit({ cwd: repo.directory, args: ['ls-files'] });
    expect(result).toStrictEqual({ ok: true, value: 'ünï code.txt\n' });
  });

  test('classifies a directory outside any repository', async ({ expect, repo }) => {
    const outside = repo.scratch();
    const result = await runGit({ cwd: outside, args: ['status'] });
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-a-repository', path: outside } });
  });

  test('classifies a missing cwd and a missing git binary', async ({ expect, repo }) => {
    const missing = path.join(repo.scratch(), 'nope');
    await expect(runGit({ cwd: missing, args: ['status'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-a-repository' },
    });
    await expect(
      runGit({ cwd: repo.directory, args: ['status'], gitBinary: '/nonexistent/git' }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'git-not-found', gitBinary: '/nonexistent/git' },
    });
  });

  test('reports failures with exit code and stderr', async ({ expect, repo }) => {
    const result = await runGit({ cwd: repo.directory, args: ['cat-file', '-t', 'deadbeef'] });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'command-failed',
        exitCode: 128,
        stderr: expect.stringContaining('deadbeef') as unknown,
      },
    });
  });

  test('times out slow commands and caps output', async ({ expect, repo }) => {
    const slow = path.join(repo.scratch(), 'slow-git');
    writeFileSync(slow, '#!/bin/sh\nsleep 5\n');
    chmodSync(slow, 0o755);
    await expect(
      runGit({
        cwd: repo.directory,
        args: ['status'],
        gitBinary: slow,
        timeout: Temporal.Duration.from({ milliseconds: 100 }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 100 }) },
    });

    repo.write('big.txt', 'x'.repeat(10_000));
    await repo.commit('big');
    await expect(
      runGit({ cwd: repo.directory, args: ['show', 'HEAD:big.txt'], maxBufferBytes: 100 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'output-too-large', maxBufferBytes: 100 },
    });
  });

  test('rejects relative directories and NUL bytes before spawning', async ({ expect, repo }) => {
    await expect(runGit({ cwd: 'relative', args: ['status'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(runGit({ cwd: repo.directory, args: ['log', 'a\0b'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument', reason: 'contains a NUL byte' },
    });
  });

  // Sets process.env, which every git process spawned meanwhile would inherit.
  test(
    'ignores inherited GIT_* variables that would redirect git',
    { concurrent: false },
    async ({ expect, repo, repositories }) => {
      const other = await repositories.create();
      const saved = process.env['GIT_DIR'];
      try {
        process.env['GIT_DIR'] = path.join(other.directory, '.git');
        const result = await runGit({
          cwd: repo.directory,
          args: ['rev-parse', '--show-toplevel'],
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

  test('disables repository-configured fsmonitor commands', async ({ expect, repo }) => {
    const marker = path.join(repo.scratch(), 'fsmonitor-ran');
    const hook = path.join(repo.scratch(), 'fsmonitor');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(hook, 0o755);
    repo.write('a.txt', 'a');
    await repo.commit('a');
    await repo.git('config', 'core.fsmonitor', hook);
    await runGit({ cwd: repo.directory, args: ['status', '--porcelain'] });
    expect(existsSync(marker)).toBe(false);
  });

  test('logs each invocation at debug level', async ({ expect, repo }) => {
    const lines: string[] = [];
    const logger = createLogger('git', {
      level: 'debug',
      sink: (line): void => {
        lines.push(line);
      },
    });
    await runGit({ cwd: repo.directory, args: ['status'], logger });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      message: 'git',
      args: ['status'],
      exitCode: 0,
    });
  });
});
