import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { addWorktree } from '#internal/git/add-worktree.ts';
import type { GitError } from '#internal/git/git-error.ts';
import { listWorktrees } from '#internal/git/list-worktrees.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository, OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { planWorktreePath } from '#internal/git/plan-worktree-path.ts';
import { pruneWorktrees } from '#internal/git/prune-worktrees.ts';
import { removeWorktree } from '#internal/git/remove-worktree.ts';
import { errorFrom } from '#x/error/error-from.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { untilAborted } from '#x/async/until-aborted.ts';
import { err } from '#x/result/err.ts';
import { fromPromise } from '#x/result/from-promise.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

export interface SessionWorktreesOptions {
  /** Directory beuve owns for checkouts, `<userData>/worktrees`. Created on first use. */
  readonly root: string;
  readonly logger: Logger;
  /** How the manager opens its own handles: its git work never runs on a caller's signal. */
  readonly git: OpenRepositoryOptions;
  /** A session's stored head (ADR 0078), or `undefined` once the session is gone. */
  readonly storedHead: (sessionId: string) => CommitSha | undefined;
}

/** A session's stored head, as `prune` keeps it. */
export interface WorktreeKeep {
  readonly repoPath: string;
  readonly headSha: CommitSha;
}

/** What a lease is for, which decides how long its checkout lives once nobody holds it. */
export type WorktreeClaim =
  /**
   * The session's head: `headSha` must be its stored head, both when asked and when the checkout
   * is ready. It becomes the session's checkout, kept while it is the session's head; the
   * session's previous checkout goes once nobody leases it.
   */
  | { readonly kind: 'session-head'; readonly sessionId: string; readonly headSha: CommitSha }
  /** A commit a sheet pins (ADR 0067): any commit, kept until the next startup prune. */
  | { readonly kind: 'pinned-commit'; readonly sessionId: string; readonly commit: CommitSha };

/**
 * A checkout that stays on disk, at `commit`, until it is disposed (`using lease = …`). Disposing
 * twice releases once.
 */
export interface WorktreeLease extends Disposable {
  readonly path: string;
  readonly commit: CommitSha;
}

/** Why no lease was granted. Nothing on disk changed for a `stale-head` refusal. */
export type WorktreeLeaseError =
  | GitError
  | {
      readonly kind: 'stale-head';
      readonly sessionId: string;
      readonly requested: CommitSha;
      readonly stored: CommitSha | undefined;
    };

export interface AcquireWorktreeOptions {
  /** Stops waiting for the checkout (`aborted`); the checkout itself finishes (ADR 0079). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Detached checkouts for language servers, chat, the sandbox, trace probes and the editor (ADR
 * 0020, 0079). One worktree per (repository, commit) at `<root>/<repo>-<hash>/<commit>`, shared
 * by every lease on that commit.
 */
export interface SessionWorktrees {
  /**
   * A lease on the checkout `claim` names, created on first need. Creating and removing a path
   * are serialised, so a lease never gets a checkout that is being removed: it waits for the
   * removal and checks the commit out again. A checkout is removed only when no lease holds it
   * and it is no session's current checkout or a sheet's pinned one.
   */
  readonly acquire: (
    repository: GitRepository,
    claim: WorktreeClaim,
    options?: AcquireWorktreeOptions,
  ) => Promise<Result<WorktreeLease, WorktreeLeaseError>>;
  /**
   * Startup cleanup: forgets stale worktree records and removes every checkout under the root
   * except those at a kept head. Never touches the repositories' own working trees. Never rejects.
   */
  readonly prune: (keep: readonly WorktreeKeep[]) => Promise<void>;
  /** Resolves once every queued add and removal has finished, for quitting and tests. */
  readonly settled: () => Promise<void>;
}

/** One checkout path: its leases, and the chain its adds and removals run on, one at a time. */
interface Entry {
  readonly path: string;
  readonly repository: GitRepository;
  leases: number;
  steps: number;
  tail: Promise<unknown>;
}

/** Creates the worktree manager. It holds only in-memory bookkeeping; git holds the rest. */
export function createSessionWorktrees(options: SessionWorktreesOptions): SessionWorktrees {
  const { logger } = options;
  const entries = new Map<string, Entry>();
  /** Holder (a session, or a sheet's pinned commit) → the checkout path it keeps. */
  const holders = new Map<string, string>();
  const handles = new Map<string, Promise<Result<GitRepository, GitError>>>();
  let canonicalRoot: Promise<Result<string, GitError>> | undefined;
  let pruning: Promise<void> | undefined;

  /** The manager's own handle on a repository, bound to no caller's signal. */
  const handleFor = async (repository: GitRepository): Promise<Result<GitRepository, GitError>> => {
    const cached = handles.get(repository.root);
    if (cached !== undefined) {
      return cached;
    }
    const opening = openRepository(repository.root, options.git);
    handles.set(repository.root, opening);
    const opened = await opening;
    if (!opened.ok) {
      handles.delete(repository.root);
    }
    return opened;
  };

  const rootPath = async (): Promise<Result<string, GitError>> => {
    canonicalRoot ??= fromPromise(
      (async (): Promise<string> => {
        await mkdir(options.root, { recursive: true });
        return realpath(options.root);
      })(),
      (cause): GitError => ({
        kind: 'invalid-argument',
        argument: options.root,
        reason: errorFrom(cause).message,
      }),
    );
    const resolved = await canonicalRoot;
    if (!resolved.ok) {
      canonicalRoot = undefined;
    }
    return resolved;
  };

  const isHeld = (path: string): boolean => {
    for (const held of holders.values()) {
      if (held === path) {
        return true;
      }
    }
    return false;
  };

  const forget = (entry: Entry): void => {
    if (entry.leases === 0 && entry.steps === 0 && !isHeld(entry.path)) {
      entries.delete(entry.path);
    }
  };

  /** Runs `step` after every step queued on `entry` before it. */
  const serially = async <T>(entry: Entry, step: () => Promise<T>): Promise<T> => {
    const previous = entry.tail;
    const done = Promise.withResolvers<undefined>();
    entry.tail = done.promise;
    entry.steps += 1;
    try {
      await previous;
      return await step();
    } finally {
      entry.steps -= 1;
      done.resolve(undefined);
      forget(entry);
    }
  };

  /** Removes `path`'s checkout once nobody leases or keeps it; queued behind its other steps. */
  const collect = (path: string): void => {
    const entry = entries.get(path);
    if (entry === undefined) {
      return;
    }
    void serially(entry, async (): Promise<void> => {
      if (entry.leases > 0 || isHeld(path)) {
        return;
      }
      const removed = await removeWorktree(entry.repository, path, { force: true });
      if (!removed.ok) {
        logger.warn('could not remove an unused worktree', { path, error: removed.error });
      }
    });
  };

  const staleness = (claim: WorktreeClaim): WorktreeLeaseError | undefined => {
    if (claim.kind !== 'session-head') {
      return undefined;
    }
    const stored = options.storedHead(claim.sessionId);
    return stored === claim.headSha
      ? undefined
      : { kind: 'stale-head', sessionId: claim.sessionId, requested: claim.headSha, stored };
  };

  const hold = (holder: string, path: string): void => {
    const previous = holders.get(holder);
    holders.set(holder, path);
    if (previous !== undefined && previous !== path) {
      collect(previous);
    }
  };

  /** Checks the commit out (or finds it) and, if the claim still holds, records its holder. */
  const grant = async (
    entry: Entry,
    root: string,
    claim: WorktreeClaim,
    commit: CommitSha,
  ): Promise<Result<undefined, WorktreeLeaseError>> => {
    const stopwatch = new Stopwatch();
    const added = await addWorktree(entry.repository, { root, commit });
    if (!added.ok) {
      return added;
    }
    logger.debug('worktree ready', { path: entry.path, duration: stopwatch.elapsed() });
    const stale = staleness(claim);
    if (stale !== undefined) {
      return err(stale);
    }
    hold(holderOf(claim), entry.path);
    return ok(undefined);
  };

  const leaseOn = (entry: Entry, commit: CommitSha): WorktreeLease => {
    let isReleased = false;
    return {
      path: entry.path,
      commit,
      [Symbol.dispose]: (): void => {
        if (isReleased) {
          return;
        }
        isReleased = true;
        entry.leases -= 1;
        if (entry.leases === 0) {
          collect(entry.path);
        }
      },
    };
  };

  return {
    acquire: async (
      repository,
      claim,
      acquireOptions = {},
    ): Promise<Result<WorktreeLease, WorktreeLeaseError>> => {
      const { signal } = acquireOptions;
      await pruning;
      if (signal?.aborted === true) {
        return err({ kind: 'aborted', args: [] });
      }
      const stale = staleness(claim);
      if (stale !== undefined) {
        return err(stale);
      }
      const commit = claim.kind === 'session-head' ? claim.headSha : claim.commit;
      const own = await handleFor(repository);
      if (!own.ok) {
        return own;
      }
      const root = await rootPath();
      if (!root.ok) {
        return root;
      }
      const planned = planWorktreePath(root.value, own.value.root, commit);
      if (!planned.ok) {
        return planned;
      }
      const path = planned.value;
      const entry = entries.getOrInsertComputed(path, () => ({
        path,
        repository: own.value,
        leases: 0,
        steps: 0,
        tail: Promise.resolve(),
      }));
      entry.leases += 1;
      const lease = leaseOn(entry, commit);
      const granted = serially(entry, async () => grant(entry, root.value, claim, commit));
      const outcome = signal === undefined ? await granted : await untilAborted(granted, signal);
      if (outcome === 'aborted' || !outcome.ok) {
        lease[Symbol.dispose]();
        return outcome === 'aborted' ? err({ kind: 'aborted', args: [] }) : outcome;
      }
      return ok(lease);
    },
    prune: async (keep): Promise<void> => {
      pruning = (async (): Promise<void> => {
        try {
          await pruneAll(options, keep);
        } catch (error: unknown) {
          logger.warn('worktree cleanup failed', { error });
        }
      })();
      await pruning;
    },
    settled: async (): Promise<void> => {
      const tails = (): Promise<unknown>[] => {
        const pending: Promise<unknown>[] = [];
        for (const entry of entries.values()) {
          if (entry.steps > 0) {
            pending.push(entry.tail);
          }
        }
        return pending;
      };
      for (let pending = tails(); pending.length > 0; pending = tails()) {
        await Promise.all(pending);
      }
    },
  };
}

/** The key a claim keeps its checkout under: one per session, one per sheet-pinned commit. */
function holderOf(claim: WorktreeClaim): string {
  return claim.kind === 'session-head'
    ? `session\0${claim.sessionId}`
    : `pinned\0${claim.sessionId}\0${claim.commit}`;
}

async function pruneAll(
  options: SessionWorktreesOptions,
  keep: readonly WorktreeKeep[],
): Promise<void> {
  const { logger } = options;
  await mkdir(options.root, { recursive: true });
  const root = await realpath(options.root);
  const registered = new Set<string>();
  const repoPaths = new Set(keep.map((entry) => entry.repoPath));
  for (const repoPath of repoPaths) {
    const repository = await openRepository(repoPath, options.git);
    if (!repository.ok) {
      logger.info('skipping worktree cleanup for an unavailable repository', { repoPath });
      continue;
    }
    const heads = keep.filter((entry) => entry.repoPath === repoPath).map((entry) => entry.headSha);
    const kept = await pruneRepository(repository.value, root, heads, logger);
    for (const worktreePath of kept) {
      registered.add(worktreePath);
    }
  }
  await removeStrayDirectories(root, registered, logger);
}

/** Removes this repository's worktrees under `root` except those at `heads`; returns the kept paths. */
async function pruneRepository(
  repository: GitRepository,
  root: string,
  heads: readonly CommitSha[],
  logger: Logger,
): Promise<readonly string[]> {
  await pruneWorktrees(repository);
  const worktrees = await listWorktrees(repository);
  if (!worktrees.ok) {
    return [];
  }
  const wanted = new Set<string>();
  for (const head of heads) {
    const planned = planWorktreePath(root, repository.root, head);
    if (planned.ok) {
      wanted.add(planned.value);
    }
  }
  const kept: string[] = [];
  for (const worktree of worktrees.value) {
    if (!isInside(root, worktree.path)) {
      continue;
    }
    if (wanted.has(worktree.path) && worktree.head !== undefined && heads.includes(worktree.head)) {
      kept.push(worktree.path);
      continue;
    }
    const removed = await removeWorktree(repository, worktree.path, { force: true });
    if (!removed.ok) {
      logger.warn('could not remove a stale worktree', {
        path: worktree.path,
        error: removed.error,
      });
    }
  }
  return kept;
}

/** Deletes checkouts under `root` that no known repository has registered (`<root>/<repo>/<commit>`). */
async function removeStrayDirectories(
  root: string,
  registered: ReadonlySet<string>,
  logger: Logger,
): Promise<void> {
  const repositories = await listDirectories(root);
  for (const repositoryDirectory of repositories) {
    const checkouts = await listDirectories(repositoryDirectory);
    for (const checkout of checkouts) {
      if (registered.has(checkout)) {
        continue;
      }
      logger.info('removing a stray worktree directory', { path: checkout });
      await rm(checkout, { recursive: true, force: true });
    }
    const remaining = await listDirectories(repositoryDirectory);
    if (remaining.length === 0) {
      await rm(repositoryDirectory, { recursive: true, force: true });
    }
  }
}

async function listDirectories(directory: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
