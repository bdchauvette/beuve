import { describe } from 'vitest';

import { streamGit } from './stream-git.ts';
import { test } from './testing/test.ts';

describe('streamGit', () => {
  test('streams stdout and stops git when asked', async ({ expect, repo, signal }) => {
    for (let index = 0; index < 200; index += 1) {
      repo.write(`f${String(index)}.txt`, 'x\n');
    }
    await repo.commit('many');
    const chunks: Buffer[] = [];
    await expect(
      streamGit({
        cwd: repo.directory,
        args: ['ls-tree', '-r', '--name-only', 'HEAD'],
        policy: { kind: 'read' },
        onStdout: (chunk) => {
          chunks.push(chunk);
          return 'more';
        },
        signal,
      }),
    ).resolves.toStrictEqual({ ok: true, value: 'complete' });
    expect(Buffer.concat(chunks).toString('utf8').split('\n')).toHaveLength(201);
    await expect(
      streamGit({
        cwd: repo.directory,
        args: ['log', '--all', '--format=%H', '--no-walk=unsorted', 'HEAD'],
        policy: { kind: 'read' },
        onStdout: () => {
          return 'stop';
        },
        signal,
      }),
    ).resolves.toStrictEqual({ ok: true, value: 'stopped' });
  });

  test('reports failures, aborts and a missing git', async ({ expect, repo, tempDir, signal }) => {
    await expect(
      streamGit({
        cwd: repo.directory,
        args: ['rev-parse', '--verify', 'no-such-ref'],
        policy: { kind: 'read' },
        onStdout: () => {
          return 'more';
        },
        signal,
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'command-failed', exitCode: 128 } });
    await expect(
      streamGit({
        cwd: repo.directory,
        args: ['status'],
        policy: { kind: 'read' },
        signal: AbortSignal.abort(),
        onStdout: () => {
          return 'more';
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    await expect(
      streamGit({
        cwd: repo.directory,
        args: ['status'],
        gitBinary: `${tempDir}/no-such-git`,
        policy: { kind: 'read' },
        onStdout: () => {
          return 'more';
        },
        signal,
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'git-not-found' } });
    await expect(
      streamGit({
        cwd: 'relative',
        args: [],
        policy: { kind: 'read' },
        onStdout: () => {
          return 'more';
        },
        signal,
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
  });
});
