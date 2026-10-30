import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '#x/log/create-logger.ts';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { runGit } from './run-git.ts';

describe('runGit', () => {
  let repo: TestRepository;
  beforeEach(() => {
    repo = createTestRepository();
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('returns stdout with quotepath off', async () => {
    repo.write('ünï code.txt', 'x');
    repo.commit('first');
    const result = await runGit({ cwd: repo.directory, args: ['ls-files'] });
    expect(result).toEqual({ ok: true, value: 'ünï code.txt\n' });
  });

  it('classifies a directory outside any repository', async () => {
    const outside = repo.scratch();
    const result = await runGit({ cwd: outside, args: ['status'] });
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-a-repository', path: outside } });
  });

  it('classifies a missing cwd and a missing git binary', async () => {
    const missing = path.join(repo.scratch(), 'nope');
    await expect(runGit({ cwd: missing, args: ['status'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-a-repository' },
    });
    await expect(
      runGit({ cwd: repo.directory, args: ['status'], gitBinary: '/nonexistent/git' }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'git-not-found', gitBinary: '/nonexistent/git' },
    });
  });

  it('reports failures with exit code and stderr', async () => {
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

  it('times out slow commands and caps output', async () => {
    const slow = path.join(repo.scratch(), 'slow-git');
    writeFileSync(slow, '#!/bin/sh\nsleep 5\n');
    chmodSync(slow, 0o755);
    await expect(
      runGit({ cwd: repo.directory, args: ['status'], gitBinary: slow, timeoutMs: 100 }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'timeout', timeoutMs: 100 } });

    repo.write('big.txt', 'x'.repeat(10_000));
    repo.commit('big');
    await expect(
      runGit({ cwd: repo.directory, args: ['show', 'HEAD:big.txt'], maxBufferBytes: 100 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'output-too-large', maxBufferBytes: 100 },
    });
  });

  it('rejects relative directories and NUL bytes before spawning', async () => {
    await expect(runGit({ cwd: 'relative', args: ['status'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(runGit({ cwd: repo.directory, args: ['log', 'a\0b'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument', reason: 'contains a NUL byte' },
    });
  });

  it('ignores inherited GIT_* variables that would redirect git', async () => {
    const other = createTestRepository();
    const saved = process.env['GIT_DIR'];
    try {
      process.env['GIT_DIR'] = path.join(other.directory, '.git');
      const result = await runGit({ cwd: repo.directory, args: ['rev-parse', '--show-toplevel'] });
      expect(result).toEqual({ ok: true, value: `${repo.directory}\n` });
    } finally {
      if (saved === undefined) {
        delete process.env['GIT_DIR'];
      } else {
        process.env['GIT_DIR'] = saved;
      }
      other.cleanup();
    }
  });

  it('disables repository-configured fsmonitor commands', async () => {
    const marker = path.join(repo.scratch(), 'fsmonitor-ran');
    const hook = path.join(repo.scratch(), 'fsmonitor');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(hook, 0o755);
    repo.write('a.txt', 'a');
    repo.commit('a');
    repo.git('config', 'core.fsmonitor', hook);
    await runGit({ cwd: repo.directory, args: ['status', '--porcelain'] });
    expect(existsSync(marker)).toBe(false);
  });

  it('logs each invocation at debug level', async () => {
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
