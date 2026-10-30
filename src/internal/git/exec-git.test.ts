import { describe } from 'vitest';

import { execGit } from './exec-git.ts';
import { startHoldServer } from './testing/start-hold-server.ts';
import { writeHoldScript } from './testing/write-hold-script.ts';
import { test } from './testing/test.ts';

describe('execGit interruption policies', () => {
  test('read: an abort sends SIGTERM and fails with aborted', async ({
    expect,
    repo,
    closing,
    signal,
  }) => {
    const server = closing(await startHoldServer(signal));
    const git = writeHoldScript(repo.scratch(), 'git', server.port, {
      kind: 'git',
      holds: [['status']],
    });
    const controller = new AbortController();
    const running = execGit({
      cwd: repo.directory,
      args: ['status'],
      gitBinary: git.command,
      policy: { kind: 'read' },
      signal: AbortSignal.any([signal, controller.signal]),
    });
    const held = await server.next();
    controller.abort();
    await expect(running).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'aborted', args: ['status'] },
    });
    expect(git.terminations()).toHaveLength(1);
    await expect(held.ended).resolves.toBe('terminated');
  });

  test('owned-write: runs its cleanup once git has exited', async ({
    expect,
    repo,
    closing,
    signal,
  }) => {
    const server = closing(await startHoldServer(signal));
    const git = writeHoldScript(repo.scratch(), 'git', server.port, {
      kind: 'git',
      holds: [['fetch']],
    });
    const controller = new AbortController();
    const cleanups: (readonly string[])[] = [];
    const running = execGit({
      cwd: repo.directory,
      args: ['fetch', 'origin'],
      gitBinary: git.command,
      policy: {
        kind: 'owned-write',
        cleanup: (): void => {
          cleanups.push(git.terminations());
        },
      },
      signal: AbortSignal.any([signal, controller.signal]),
    });
    await server.next();
    controller.abort();
    await expect(running).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(cleanups).toStrictEqual([git.terminations()]);
    expect(git.terminations()).toHaveLength(1);
  });

  test('owned-write: no cleanup when git finishes', async ({ expect, repo, signal }) => {
    await repo.commit('first');
    const cleanups: string[] = [];
    await expect(
      execGit({
        cwd: repo.directory,
        args: ['tag', 'v1'],
        policy: {
          kind: 'owned-write',
          cleanup: (): void => {
            cleanups.push('cleaned');
          },
        },
        signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(cleanups).toStrictEqual([]);
  });

  test('atomic: git finishes despite the abort, which is then reported', async ({
    expect,
    repo,
    closing,
    signal,
  }) => {
    await repo.commit('first');
    const server = closing(await startHoldServer(signal));
    const git = writeHoldScript(repo.scratch(), 'git', server.port, {
      kind: 'git',
      holds: [['tag']],
    });
    const controller = new AbortController();
    const running = execGit({
      cwd: repo.directory,
      args: ['tag', 'v1'],
      gitBinary: git.command,
      policy: { kind: 'atomic' },
      signal: AbortSignal.any([signal, controller.signal]),
    });
    const held = await server.next();
    controller.abort();
    held.release();
    await expect(running).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'aborted', args: ['tag', 'v1'] },
    });
    await expect(held.ended).resolves.toBe('closed');
    expect(git.terminations()).toStrictEqual([]);
    await expect(repo.git('rev-parse', '--verify', 'refs/tags/v1')).resolves.toMatch(/^[\da-f]+$/u);
  });

  test.for(['read', 'owned-write', 'atomic'] as const)(
    '%s: an aborted signal starts nothing',
    async (kind, { expect, repo, signal }) => {
      await repo.commit('first');
      const aborted = AbortSignal.any([signal, AbortSignal.abort()]);
      await expect(
        execGit({ cwd: repo.directory, args: ['tag', 'v1'], policy: { kind }, signal: aborted }),
      ).resolves.toStrictEqual({ ok: false, error: { kind: 'aborted', args: ['tag', 'v1'] } });
      await expect(repo.git('tag', '--list')).resolves.toBe('');
    },
  );
});
