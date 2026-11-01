import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { addBranchWorktree } from '#internal/git/add-branch-worktree.ts';
import { addWorktree } from '#internal/git/add-worktree.ts';
import { canonicalWorktreeRoot } from '#internal/git/canonical-worktree-root.ts';
import { deleteBranch } from '#internal/git/delete-branch.ts';
import type { GitError } from '#internal/git/git-error.ts';
import { listWorktrees } from '#internal/git/list-worktrees.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository, OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { planBranchWorktreePath } from '#internal/git/plan-branch-worktree-path.ts';
import { planWorktreePath } from '#internal/git/plan-worktree-path.ts';
import { pruneWorktrees } from '#internal/git/prune-worktrees.ts';
import { removeWorktree } from '#internal/git/remove-worktree.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { chmodTree } from '#x/fs/chmod-tree.ts';
import { removeTree } from '#x/fs/remove-tree.ts';
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
  /**
   * Directory for the writable review-edits worktrees (ADR 0088), `<userData>/review-edits`,
   * separate from the read-only checkouts so no prune of `root` ever reaches them. Defaults to
   * `review-edits` beside `root`.
   */
  readonly editsRoot?: string;
  /**
   * Told the path of a read-only checkout that was just checked out afresh or removed, on its
   * serial chain, so whatever describes its untracked contents is forgotten.
   */
  readonly onCheckoutReset?: (path: string) => void;
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
  | { readonly kind: 'pinned-commit'; readonly sessionId: string; readonly commit: CommitSha }
  /**
   * The session's writable review-edits worktree (ADR 0088): `branch`, a real local branch that
   * starts at `base` when it is new, checked out under the edits root. Never read-only, never
   * removed when its leases go or at startup: only {@link SessionWorktrees.discardEdits} removes
   * it, with its branch.
   */
  | {
      readonly kind: 'review-edits';
      readonly sessionId: string;
      readonly branch: string;
      readonly base: CommitSha;
    };

/** The review-edits worktree to discard, and the branch tip the reviewer agreed to lose. */
export interface DiscardEditsRequest {
  readonly sessionId: string;
  readonly branch: string;
  readonly expectedTip: CommitSha;
}

/** Why a discard was refused: a git failure, or a lease still working in the worktree. */
export type DiscardEditsError =
  | GitError
  | { readonly kind: 'in-use'; readonly path: string }
  | { readonly kind: 'branch-moved'; readonly branch: string; readonly tip: CommitSha };

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
 * Detached checkouts for language servers, chat, the sandbox and the editor (ADR
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
  /**
   * Removes a session's review-edits worktree (`--force`: its uncommitted work goes) and deletes
   * its branch if it still points at `expectedTip`, on the path's serial chain. Refuses while a
   * lease holds the worktree. The caller has shown the reviewer what is lost (ADR 0088).
   */
  readonly discardEdits: (
    repository: GitRepository,
    request: DiscardEditsRequest,
  ) => Promise<Result<undefined, DiscardEditsError>>;
  /** Where `commit`'s read-only checkout is, or would be; creates nothing. */
  readonly checkoutPath: (
    repository: GitRepository,
    commit: CommitSha,
  ) => Promise<Result<string, GitError>>;
  /** Where `branch`'s review-edits worktree is, or would be, checked out; creates nothing. */
  readonly editsPath: (
    repository: GitRepository,
    branch: string,
  ) => Promise<Result<string, GitError>>;
}

/** One checkout path: its leases, and the chain its adds and removals run on, one at a time. */
interface Entry {
  readonly path: string;
  readonly repository: GitRepository;
  leases: number;
  steps: number;
  tail: Promise<unknown>;
}

/**
 * Creates the worktree manager. It holds in-memory bookkeeping; git holds the rest, and is asked
 * again whenever the bookkeeping and the disk might disagree.
 */
export function createSessionWorktrees(options: SessionWorktreesOptions): SessionWorktrees {
  const { logger } = options;
  const entries = new Map<string, Entry>();
  /** Holder (a session, or a sheet's pinned commit) → the checkout path it keeps. */
  const holders = new Map<string, string>();
  /**
   * Checkouts this manager made or the startup prune kept, path → commit (ADR 0081). A lease on
   * one whose directory is still there skips `git worktree list`; anything else (an unknown path,
   * a failed add or removal, a directory gone from disk) goes back through `addWorktree`, which
   * asks git and repairs what it finds. Changed only on a path's serial chain, or by the prune.
   */
  const checkedOut = new Map<string, CommitSha>();
  /** Review-edits worktrees this manager checked out, path → branch; same rules as `checkedOut`. */
  const branchesOut = new Map<string, string>();
  const editsRoot = options.editsRoot ?? path.join(path.dirname(options.root), 'review-edits');
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
        await mkdir(options.root, { recursive: true, mode: 0o700 });
        return realpath(options.root);
      })(),
      (cause): GitError => {
        return {
          kind: 'invalid-argument',
          argument: options.root,
          reason: errorFrom(cause).message,
        };
      },
    );
    const resolved = await canonicalRoot;
    if (!resolved.ok) {
      canonicalRoot = undefined;
    }
    return resolved;
  };

  /** The root and path of a claim's worktree: per commit under `root`, per branch under the edits root. */
  const place = async (
    repository: GitRepository,
    claim: WorktreeClaim,
  ): Promise<Result<Placed, GitError>> => {
    let root: Result<string, GitError>;
    let planned: Result<string, GitError>;
    if (claim.kind === 'review-edits') {
      root = await canonicalWorktreeRoot(editsRoot);
      if (!root.ok) {
        return root;
      }
      planned = planBranchWorktreePath({
        root: root.value,
        repositoryRoot: repository.root,
        branch: claim.branch,
      });
    } else {
      root = await rootPath();
      if (!root.ok) {
        return root;
      }
      planned = planWorktreePath(root.value, repository.root, commitOf(claim));
    }
    if (!planned.ok) {
      return planned;
    }
    return ok({ root: root.value, path: planned.value });
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
      checkedOut.delete(path);
      await removeCheckout({ repository: entry.repository, path }, logger);
      options.onCheckoutReset?.(path);
    });
  };

  const staleness = (claim: WorktreeClaim): WorktreeLeaseError | undefined => {
    if (claim.kind !== 'session-head') {
      return undefined;
    }
    const stored = options.storedHead(claim.sessionId);
    if (stored === claim.headSha) {
      return undefined;
    }
    return { kind: 'stale-head', sessionId: claim.sessionId, requested: claim.headSha, stored };
  };

  const hold = ({ holder, path }: Holding): void => {
    const previous = holders.get(holder);
    holders.set(holder, path);
    if (previous !== undefined && previous !== path) {
      collect(previous);
    }
  };

  /** Checks the branch out writable (or finds it), and keeps it as the session's edits. */
  const grantEdits = async (
    entry: Entry,
    { root, claim }: EditsGrant,
  ): Promise<Result<undefined, WorktreeLeaseError>> => {
    const isKnown =
      branchesOut.get(entry.path) === claim.branch && (await isCheckoutPresent(entry.path));
    if (!isKnown) {
      branchesOut.delete(entry.path);
      const added = await addBranchWorktree(entry.repository, {
        root,
        branch: claim.branch,
        base: claim.base,
      });
      if (!added.ok) {
        return added;
      }
      branchesOut.set(entry.path, claim.branch);
      logger.debug('review edits ready', { path: entry.path, created: added.value.createdBranch });
    }
    holders.set(holderOf(claim), entry.path);
    return ok(undefined);
  };

  /** Checks the commit out (or finds it) and, if the claim still holds, records its holder. */
  const grant = async (
    entry: Entry,
    { root, claim, commit }: Grant,
  ): Promise<Result<undefined, WorktreeLeaseError>> => {
    if (claim.kind === 'review-edits') {
      return grantEdits(entry, { root, claim });
    }
    const isKnown = checkedOut.get(entry.path) === commit && (await isCheckoutPresent(entry.path));
    if (!isKnown) {
      checkedOut.delete(entry.path);
      const stopwatch = new Stopwatch();
      const added = await addWorktree(entry.repository, { root, commit });
      if (!added.ok) {
        return added;
      }
      options.onCheckoutReset?.(entry.path);
      checkedOut.set(entry.path, commit);
      logger.debug('worktree ready', { path: entry.path, duration: stopwatch.elapsed() });
    }
    const stale = staleness(claim);
    if (stale !== undefined) {
      return err(stale);
    }
    hold({ holder: holderOf(claim), path: entry.path });
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
      const commit = commitOf(claim);
      const own = await handleFor(repository);
      if (!own.ok) {
        return own;
      }
      const placed = await place(own.value, claim);
      if (!placed.ok) {
        return placed;
      }
      const { root, path } = placed.value;
      const entry = entries.getOrInsertComputed(path, () => {
        return {
          path,
          repository: own.value,
          leases: 0,
          steps: 0,
          tail: Promise.resolve(),
        };
      });
      entry.leases += 1;
      const lease = leaseOn(entry, commit);
      const granted = serially(entry, async () => {
        return grant(entry, { root, claim, commit });
      });
      let outcome: Result<undefined, WorktreeLeaseError> | 'aborted';
      if (signal === undefined) {
        outcome = await granted;
      } else {
        outcome = await untilAborted(granted, signal);
      }
      if (outcome === 'aborted' || !outcome.ok) {
        lease[Symbol.dispose]();
        if (outcome === 'aborted') {
          return err({ kind: 'aborted', args: [] });
        }
        return outcome;
      }
      return ok(lease);
    },
    prune: async (keep): Promise<void> => {
      pruning = (async (): Promise<void> => {
        checkedOut.clear();
        try {
          const kept = await pruneAll(options, keep);
          for (const [path, commit] of kept) {
            await unsealLegacyCheckout(path, logger);
            checkedOut.set(path, commit);
          }
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
    checkoutPath: async (repository, commit): Promise<Result<string, GitError>> => {
      const placed = await place(repository, { kind: 'pinned-commit', sessionId: '', commit });
      if (!placed.ok) {
        return placed;
      }
      return ok(placed.value.path);
    },
    editsPath: async (repository, branch): Promise<Result<string, GitError>> => {
      const placed = await place(repository, {
        kind: 'review-edits',
        sessionId: '',
        branch,
        base: '' as CommitSha,
      });
      if (!placed.ok) {
        return placed;
      }
      return ok(placed.value.path);
    },
    discardEdits: async (
      repository,
      { sessionId, branch, expectedTip },
    ): Promise<Result<undefined, DiscardEditsError>> => {
      const own = await handleFor(repository);
      if (!own.ok) {
        return own;
      }
      const placed = await place(own.value, {
        kind: 'review-edits',
        sessionId,
        branch,
        base: expectedTip,
      });
      if (!placed.ok) {
        return placed;
      }
      const { path } = placed.value;
      const entry = entries.getOrInsertComputed(path, () => {
        return { path, repository: own.value, leases: 0, steps: 0, tail: Promise.resolve() };
      });
      return serially(entry, async (): Promise<Result<undefined, DiscardEditsError>> => {
        if (entry.leases > 0) {
          return err({ kind: 'in-use', path });
        }
        const tip = await resolveRevision(own.value, `refs/heads/${branch}`);
        if (tip.ok && tip.value !== expectedTip) {
          return err({ kind: 'branch-moved', branch, tip: tip.value });
        }
        branchesOut.delete(path);
        holders.delete(`edits\0${sessionId}`);
        const removed = await removeWorktree(own.value, path, { force: true });
        if (!removed.ok && (await isCheckoutPresent(path))) {
          return removed;
        }
        await removeTree(path);
        await pruneWorktrees(own.value);
        if (!tip.ok) {
          return ok(undefined);
        }
        return deleteBranch(own.value, { branch, expected: expectedTip });
      });
    },
  };
}

/** The key a claim keeps its checkout under: one per session, one per sheet-pinned commit. */
function holderOf(claim: WorktreeClaim): string {
  if (claim.kind === 'session-head') {
    return `session\0${claim.sessionId}`;
  }
  if (claim.kind === 'review-edits') {
    return `edits\0${claim.sessionId}`;
  }
  return `pinned\0${claim.sessionId}\0${claim.commit}`;
}

/**
 * Whether a linked worktree this manager checked out is still on disk, judged by its `.git`
 * file. Only asked of checkouts whose add finished, so a half-written one never gets here.
 */
async function isCheckoutPresent(worktreePath: string): Promise<boolean> {
  try {
    const stats = await stat(path.join(worktreePath, '.git'));
    return stats.isFile();
  } catch {
    return false;
  }
}

/** Prunes every repository in `keep` and the root; answers the checkouts kept, path → commit. */
async function pruneAll(
  options: SessionWorktreesOptions,
  keep: readonly WorktreeKeep[],
): Promise<ReadonlyMap<string, CommitSha>> {
  const { logger } = options;
  await mkdir(options.root, { recursive: true, mode: 0o700 });
  const root = await realpath(options.root);
  const registered = new Map<string, CommitSha>();
  const repoPaths = new Set(keep.map((entry) => entry.repoPath));
  for (const repoPath of repoPaths) {
    const repository = await openRepository(repoPath, options.git);
    if (!repository.ok) {
      logger.info('skipping worktree cleanup for an unavailable repository', { repoPath });
      continue;
    }
    const heads = keep.filter((entry) => entry.repoPath === repoPath).map((entry) => entry.headSha);
    const kept = await pruneRepository(
      repository.value,
      { root, heads, onReset: options.onCheckoutReset },
      logger,
    );
    for (const worktree of kept) {
      registered.set(worktree.path, worktree.head);
    }
  }
  await removeStrayDirectories({ root, registered, onReset: options.onCheckoutReset }, logger);
  return registered;
}

/** The worktree root to prune under, and the heads whose worktrees stay. */
interface PruneScope {
  readonly root: string;
  readonly heads: readonly CommitSha[];
  readonly onReset: ((path: string) => void) | undefined;
}

/** A worktree that survived the prune, and the commit it has checked out. */
interface KeptWorktree {
  readonly path: string;
  readonly head: CommitSha;
}

/** Who holds a checkout now, and where it is. */
interface Holding {
  readonly holder: string;
  readonly path: string;
}

/** A claim to grant, the commit it resolves to, and the worktree root it checks out under. */
interface Grant {
  readonly root: string;
  readonly claim: WorktreeClaim;
  readonly commit: CommitSha;
}

/** A review-edits claim to grant, and the edits root it checks out under. */
interface EditsGrant {
  readonly root: string;
  readonly claim: Extract<WorktreeClaim, { kind: 'review-edits' }>;
}

/** Where a claim's worktree goes: the root it lives under, and its own path. */
interface Placed {
  readonly root: string;
  readonly path: string;
}

function commitOf(claim: WorktreeClaim): CommitSha {
  if (claim.kind === 'session-head') {
    return claim.headSha;
  }
  if (claim.kind === 'review-edits') {
    return claim.base;
  }
  return claim.commit;
}

/** Removes this repository's worktrees under `root` except those at `heads`; returns the kept ones. */
async function pruneRepository(
  repository: GitRepository,
  { root, heads, onReset }: PruneScope,
  logger: Logger,
): Promise<readonly KeptWorktree[]> {
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
  const kept: KeptWorktree[] = [];
  for (const worktree of worktrees.value) {
    if (!isInside({ root, candidate: worktree.path })) {
      continue;
    }
    const { head } = worktree;
    if (head !== undefined && wanted.has(worktree.path) && heads.includes(head)) {
      kept.push({ path: worktree.path, head });
      continue;
    }
    await removeCheckout({ repository, path: worktree.path }, logger);
    onReset?.(worktree.path);
  }
  return kept;
}

/** Deletes checkouts under `root` that no known repository has registered (`<root>/<repo>/<commit>`). */
async function removeStrayDirectories(
  { root, registered, onReset }: StrayScope,
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
      await removeTree(checkout);
      onReset?.(checkout);
    }
    const remaining = await listDirectories(repositoryDirectory);
    if (remaining.length === 0) {
      await removeTree(repositoryDirectory);
    }
  }
}

/** The root to clean, the checkouts git still registers there, and who hears of a removal. */
interface StrayScope {
  readonly root: string;
  readonly registered: ReadonlyMap<string, CommitSha>;
  readonly onReset: ((path: string) => void) | undefined;
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

/** A path, and the directory it must be strictly inside. */
interface Containment {
  readonly root: string;
  readonly candidate: string;
}

function isInside({ root, candidate }: Containment): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** A checkout to remove, and the repository it is registered in. */
interface CheckoutPlace {
  readonly repository: GitRepository;
  readonly path: string;
}

/**
 * Removes a checkout (`git worktree remove --force`, untracked installs included). When git
 * can't, for instance because a tool left a read-only directory in it, the tree goes with
 * `removeTree` and git forgets the record (`worktree prune`). Failures are logged.
 */
async function removeCheckout({ repository, path }: CheckoutPlace, logger: Logger): Promise<void> {
  await unsealLegacyCheckout(path, logger);
  const removed = await removeWorktree(repository, path, { force: true });
  if (removed.ok) {
    return;
  }
  logger.info('git could not remove a worktree; removing its tree', {
    path,
    error: removed.error,
  });
  try {
    await removeTree(path);
  } catch (error: unknown) {
    logger.warn('could not remove an unused worktree', { path, error: errorFrom(error) });
    return;
  }
  await pruneWorktrees(repository);
}

/**
 * Gives a checkout an older beuve sealed (ADR 0033's first amendment cleared every write bit)
 * its owner's write bits back, once: checkouts are now read-only by convention only, and the
 * reviewer's terminal writes into them (ADR 0095). A checkout whose top directory is writable is left as it
 * is, so this costs one `stat` after the first time. Links are never followed. Failures are logged.
 */
async function unsealLegacyCheckout(checkout: string, logger: Logger): Promise<void> {
  try {
    await using handle = await open(checkout, constants.O_RDONLY | constants.O_NOFOLLOW);
    const { mode } = await handle.stat();
    if ((mode & 0o200) !== 0) {
      return;
    }
  } catch {
    return;
  }
  try {
    await chmodTree(checkout, {
      file: (mode) => {
        return mode | 0o200;
      },
      directory: (mode) => {
        return mode | 0o700;
      },
    });
    logger.info('unsealed a checkout an older beuve made read-only', { path: checkout });
  } catch (error: unknown) {
    logger.warn('could not unseal a checkout', { path: checkout, error: errorFrom(error) });
  }
}
