import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import type { CommitSha } from '#internal/git/object-id.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository, OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { startHoldServer } from '#internal/git/testing/start-hold-server.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { writeHoldScript } from '#internal/git/testing/write-hold-script.ts';
import { chmodTree } from '#x/fs/chmod-tree.ts';
import { removeTree } from '#x/fs/remove-tree.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { attemptWrite } from '#testing/attempt-write.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { createSessionWorktrees } from './create-session-worktrees.ts';
import type { SessionWorktrees, WorktreeClaim } from './create-session-worktrees.ts';

describe('createSessionWorktrees', () => {
  test('refuses a stale head and leaves the current checkout alone (audit race 1)', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c1);
    okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }))[Symbol.dispose]();
    heads.set('S', c2);
    using current = okValueFrom(await worktrees.acquire(repository, head('S', c2), { signal }));
    await worktrees.settled();
    const old = path.join(path.dirname(current.path), c1);
    await expect(worktrees.acquire(repository, head('S', c1), { signal })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'stale-head', sessionId: 'S', requested: c1, stored: c2 },
    });
    await worktrees.settled();
    expect(readFileSync(path.join(current.path, 'f.txt'), 'utf8')).toBe('2\n');
    expect(existsSync(old)).toBe(false);
  });

  test('a lease on a checkout being removed waits and gets it back whole (audit race 2)', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    closing,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const server = closing(await startHoldServer(signal));
    const git = writeHoldScript({ directory: repo.scratch(), name: 'git' }, server.port, {
      kind: 'git',
      holds: [['worktree', 'remove']],
    });
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, {
      gitBinary: git.command,
      signal,
    });
    heads.set('A', c1);
    heads.set('B', c1);
    okValueFrom(await worktrees.acquire(repository, head('A', c1), { signal }))[Symbol.dispose]();
    heads.set('A', c2);
    using _a = okValueFrom(await worktrees.acquire(repository, head('A', c2), { signal }));
    const removal = await server.next();
    const b = worktrees.acquire(repository, head('B', c1), { signal });
    removal.release();
    using shared = okValueFrom(await b);
    expect(readFileSync(path.join(shared.path, 'f.txt'), 'utf8')).toBe('1\n');
    await worktrees.settled();
    expect(existsSync(path.join(shared.path, 'f.txt'))).toBe(true);
  });

  test('keeps a leased checkout after the head moves, and removes it on release', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c1);
    const leased = async (): Promise<string> => {
      using old = okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }));
      heads.set('S', c2);
      using _current = okValueFrom(await worktrees.acquire(repository, head('S', c2), { signal }));
      await worktrees.settled();
      expect(readFileSync(path.join(old.path, 'f.txt'), 'utf8')).toBe('1\n');
      old[Symbol.dispose]();
      return old.path;
    };
    const old = await leased();
    await worktrees.settled();
    expect(existsSync(old)).toBe(false);
  });

  test('refuses a head that moved while it was checked out, and drops that checkout', async ({
    expect,
    repo,
    worktreeRoot,
    logger,
    closing,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const server = closing(await startHoldServer(signal));
    const git = writeHoldScript({ directory: repo.scratch(), name: 'git' }, server.port, {
      kind: 'git',
      holds: [['worktree', 'add']],
    });
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, {
      gitBinary: git.command,
      signal,
    });
    const repository = await opened(repo, git.command, signal);
    heads.set('S', c1);
    const acquiring = worktrees.acquire(repository, head('S', c1), { signal });
    const adding = await server.next();
    heads.set('S', c2);
    adding.release();
    await expect(acquiring).resolves.toMatchObject({ ok: false, error: { kind: 'stale-head' } });
    await worktrees.settled();
    await expect(repo.git('worktree', 'list', '--porcelain')).resolves.not.toContain(c1);
  });

  test('an aborted lease lets a half-done checkout finish, and the next lease gets it', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    closing,
    signal,
  }) => {
    const server = closing(await startHoldServer(signal));
    const smudge = writeHoldScript({ directory: repo.scratch(), name: 'smudge' }, server.port, {
      kind: 'smudge',
    });
    repo.write('.gitattributes', 'held.txt filter=hold\n');
    repo.write('a.txt', 'a\n');
    repo.write('held.txt', 'held\n');
    const c1 = await repo.commit('one');
    await repo.git('config', 'filter.hold.smudge', smudge.command);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c1);
    const controller = new AbortController();
    const acquiring = worktrees.acquire(repository, head('S', c1), {
      signal: AbortSignal.any([signal, controller.signal]),
    });
    const filter = await server.next();
    controller.abort();
    await expect(acquiring).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'aborted', args: [] },
    });
    filter.release();
    await worktrees.settled();
    await expect(filter.ended).resolves.toBe('closed');
    await expect(locksUnder(repo)).resolves.toStrictEqual([]);
    using next = okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }));
    expect(readFileSync(path.join(next.path, 'held.txt'), 'utf8')).toBe('held\n');
    expect(readFileSync(path.join(next.path, 'a.txt'), 'utf8')).toBe('a\n');
    await expect(repo.git('worktree', 'list', '--porcelain')).resolves.toContain(next.path);
  });

  test('keeps a sheet’s pinned commit after release, whatever the head', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c2);
    const claim: WorktreeClaim = { kind: 'pinned-commit', sessionId: 'S', commit: c1 };
    const pinned = async (): Promise<string> => {
      using lease = okValueFrom(await worktrees.acquire(repository, claim, { signal }));
      return lease.path;
    };
    const kept = await pinned();
    await worktrees.settled();
    expect(readFileSync(path.join(kept, 'f.txt'), 'utf8')).toBe('1\n');
  });

  test('leases a checkout it made without asking git again, until it is gone from disk (ADR 0081)', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, {
      signal,
      logger: logger.logger,
    });
    heads.set('S', c1);
    using first = okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }));
    okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }))[Symbol.dispose]();
    okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }))[Symbol.dispose]();
    expect(worktreeCommands(logger.lines)).toStrictEqual([['list'], ['add']]);
    await removeTree(first.path);
    using again = okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }));
    expect(again.path).toBe(first.path);
    expect(readFileSync(path.join(again.path, 'f.txt'), 'utf8')).toBe('1\n');
    expect(worktreeCommands(logger.lines)).toStrictEqual([
      ['list'],
      ['add'],
      ['list'],
      ['prune'],
      ['add'],
    ]);
  });

  test('leases a checkout the startup prune kept without asking git again', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1 } = await twoCommits(repo);
    const before = manager(worktreeRoot, logger.logger, { signal });
    before.heads.set('S', c1);
    okValueFrom(await before.worktrees.acquire(repository, head('S', c1), { signal }))[
      Symbol.dispose
    ]();
    await before.worktrees.settled();
    const after = manager(worktreeRoot, logger.logger, { signal, logger: logger.logger });
    after.heads.set('S', c1);
    await after.worktrees.prune([{ repoPath: repo.directory, headSha: c1 }]);
    const pruned = worktreeCommands(logger.lines);
    using lease = okValueFrom(await after.worktrees.acquire(repository, head('S', c1), { signal }));
    expect(readFileSync(path.join(lease.path, 'f.txt'), 'utf8')).toBe('1\n');
    expect(pruned).toStrictEqual([['prune'], ['list']]);
    expect(worktreeCommands(logger.lines)).toStrictEqual(pruned);
  });

  test('checkouts are read-only by convention only: an install can add untracked files', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c1);
    using lease = okValueFrom(await worktrees.acquire(repository, head('S', c1), { signal }));
    await expect(attemptWrite(path.join(lease.path, 'node_modules.txt'), signal)).resolves.toBe(
      'written',
    );
    expect(readFileSync(path.join(lease.path, 'f.txt'), 'utf8')).toBe('1\n');
  });

  test('removes a checkout with untracked, read-only installs when the head moves, and prunes the rest', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const reset: string[] = [];
    const { worktrees, heads } = managerWith(worktreeRoot, logger.logger, {
      git: { signal },
      onCheckoutReset: (checkout) => {
        reset.push(checkout);
      },
    });
    heads.set('S', c1);
    const old = await leasedPath(worktrees, { repository, claim: head('S', c1), signal });
    const installed = path.join(old, 'node_modules', 'pkg');
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, 'index.js'), '');
    await chmodTree(path.join(old, 'node_modules'), {
      file: withoutWrite,
      directory: withoutWrite,
    });
    heads.set('S', c2);
    const current = await leasedPath(worktrees, { repository, claim: head('S', c2), signal });
    await worktrees.settled();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(current)).toBe(true);
    expect(reset).toStrictEqual([old, current, old]);

    await worktrees.prune([{ repoPath: repo.directory, headSha: c1 }]);
    expect(existsSync(current)).toBe(false);
    expect(reset.at(-1)).toBe(current);
    await expect(repo.git('worktree', 'list', '--porcelain')).resolves.not.toContain(current);
    expect(logger.lines.filter((line) => line['level'] === 'warn')).toStrictEqual([]);
  });

  test('the startup prune unseals a kept checkout an older beuve made read-only', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c1);
    const checkout = await leasedPath(worktrees, { repository, claim: head('S', c1), signal });
    await chmodTree(checkout, { file: withoutWrite, directory: withoutWrite });

    await worktrees.prune([{ repoPath: repo.directory, headSha: c1 }]);
    await expect(attemptWrite(path.join(checkout, 'new.txt'), signal)).resolves.toBe('written');
    await expect(attemptWrite(path.join(checkout, 'f.txt'), signal)).resolves.toBe('written');
  });

  test('review edits: a writable branch worktree that outlives its leases and the prune', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c2);
    const claim = edits(c1);
    const checkout = await leasedPath(worktrees, { repository, claim, signal });
    await worktrees.settled();
    const editsRoot = path.join(path.dirname(worktreeRoot), 'review-edits');
    expect(checkout.startsWith(editsRoot)).toBe(true);
    expect(readFileSync(path.join(checkout, 'f.txt'), 'utf8')).toBe('1\n');
    await expect(attemptWrite(path.join(checkout, 'f.txt'), signal)).resolves.toBe('written');
    await expect(attemptWrite(path.join(checkout, 'new.txt'), signal)).resolves.toBe('written');

    await worktrees.prune([{ repoPath: repo.directory, headSha: c2 }]);
    using again = okValueFrom(await worktrees.acquire(repository, claim, { signal }));
    expect(again.path).toBe(checkout);
    expect(readFileSync(path.join(checkout, 'f.txt'), 'utf8')).toBe('changed\n');
    await expect(repo.git('rev-parse', 'refs/heads/review/s')).resolves.toBe(c1);
    await expect(
      worktrees.discardEdits(repository, { sessionId: 'S', branch: 'review/s', expectedTip: c1 }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'in-use', path: checkout } });
  });

  test('discarding review edits removes the worktree and the branch, unless it moved', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1, c2 } = await twoCommits(repo);
    const { worktrees } = manager(worktreeRoot, logger.logger, { signal });
    const checkout = await leasedPath(worktrees, { repository, claim: edits(c1), signal });
    await repo.git('update-ref', 'refs/heads/review/s', c2);
    const request = { sessionId: 'S', branch: 'review/s', expectedTip: c1 };
    await expect(worktrees.discardEdits(repository, request)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'branch-moved', branch: 'review/s', tip: c2 },
    });
    expect(existsSync(checkout)).toBe(true);
    await expect(
      worktrees.discardEdits(repository, { ...request, expectedTip: c2 }),
    ).resolves.toStrictEqual({ ok: true, value: undefined });
    expect(existsSync(checkout)).toBe(false);
    await expect(repo.git('branch', '--list', 'review/s')).resolves.toBe('');
    await expect(repo.git('worktree', 'list', '--porcelain')).resolves.not.toContain(checkout);
  });

  test('an already aborted signal checks nothing out', async ({
    expect,
    repo,
    repository,
    worktreeRoot,
    logger,
    signal,
  }) => {
    const { c1 } = await twoCommits(repo);
    const { worktrees, heads } = manager(worktreeRoot, logger.logger, { signal });
    heads.set('S', c1);
    const aborted = AbortSignal.any([signal, AbortSignal.abort()]);
    await expect(
      worktrees.acquire(repository, head('S', c1), { signal: aborted }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(existsSync(worktreeRoot)).toBe(false);
  });
});

async function twoCommits(repo: TestRepository): Promise<TwoCommits> {
  repo.write('f.txt', '1\n');
  const c1 = await repo.commit('one');
  repo.write('f.txt', '2\n');
  const c2 = await repo.commit('two');
  return { c1, c2 };
}

function manager(root: string, logger: Logger, git: OpenRepositoryOptions = {}): Manager {
  return managerWith(root, logger, { git });
}

function managerWith(
  root: string,
  logger: Logger,
  { git, onCheckoutReset }: ManagerOptions,
): Manager {
  const heads = new Map<string, CommitSha>();
  const worktrees = createSessionWorktrees({
    root,
    logger,
    git,
    storedHead: (sessionId) => {
      return heads.get(sessionId);
    },
    ...(onCheckoutReset !== undefined && { onCheckoutReset }),
  });
  return { worktrees, heads };
}

/** How a test's manager opens git, and who hears of a checkout made afresh or removed. */
interface ManagerOptions {
  readonly git: OpenRepositoryOptions;
  readonly onCheckoutReset?: (checkout: string) => void;
}

function head(sessionId: string, headSha: CommitSha): WorktreeClaim {
  return { kind: 'session-head', sessionId, headSha };
}

/** Session `S`'s review edits on `review/s`, starting at `base`. */
function edits(base: CommitSha): WorktreeClaim {
  return { kind: 'review-edits', sessionId: 'S', branch: 'review/s', base };
}

async function opened(
  repo: TestRepository,
  gitBinary: string,
  signal: AbortSignal,
): Promise<GitRepository> {
  return okValueFrom(await openRepository(repo.directory, { gitBinary, signal }));
}

/** The `git worktree` subcommands logged so far, oldest first. */
function worktreeCommands(lines: readonly Readonly<Record<string, unknown>>[]): string[][] {
  return lines
    .filter((line) => line['message'] === 'git')
    .map((line) => line['args'] as readonly string[])
    .filter((args) => args[0] === 'worktree')
    .map((args) => args.slice(1, 2));
}

/** What one lease asks for. */
interface LeaseRequest {
  readonly repository: GitRepository;
  readonly claim: WorktreeClaim;
  readonly signal: AbortSignal;
}

/** Takes a lease on the claim's checkout, releases it at once, and answers its path. */
async function leasedPath(
  worktrees: SessionWorktrees,
  { repository, claim, signal }: LeaseRequest,
): Promise<string> {
  using lease = okValueFrom(await worktrees.acquire(repository, claim, { signal }));
  return lease.path;
}

function withoutWrite(mode: number): number {
  return mode & ~0o222;
}

/** Lock files anywhere under the repository's `.git`, worktree administrative files included. */
async function locksUnder(repo: TestRepository): Promise<readonly string[]> {
  const entries = await readdir(path.join(repo.directory, '.git'), { recursive: true });
  return entries.filter((entry) => entry.endsWith('.lock'));
}

/** The two commits of a repository with two. */
interface TwoCommits {
  readonly c1: CommitSha;
  readonly c2: CommitSha;
}

/** Session worktrees, and the stored session heads they check claims against. */
interface Manager {
  readonly worktrees: SessionWorktrees;
  readonly heads: Map<string, CommitSha>;
}
