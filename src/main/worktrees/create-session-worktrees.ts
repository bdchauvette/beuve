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
import type { Logger } from '#pkg/logger/create-logger.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

export interface SessionWorktreesOptions {
  /** Directory beuve owns for checkouts, `<userData>/worktrees`. Created on first use. */
  readonly root: string;
  readonly logger: Logger;
  readonly git: OpenRepositoryOptions;
}

/** A session's stored head, as `prune` keeps it. */
export interface WorktreeKeep {
  readonly repoPath: string;
  readonly headSha: CommitSha;
}

/**
 * Detached checkouts of session heads for language servers (ADR 0020). One worktree per
 * (repository, commit) at `<root>/<repo>-<hash>/<commit>`, so sessions at the same head share it.
 */
export interface SessionWorktrees {
  /**
   * The checkout of `headSha` for `sessionId`, created on first need. When the session's head has
   * moved, its previous checkout is removed unless another session still uses it.
   */
  readonly ensure: (
    repository: GitRepository,
    sessionId: string,
    headSha: CommitSha,
  ) => Promise<Result<string, GitError>>;
  /**
   * Startup cleanup: forgets stale worktree records and removes every checkout under the root
   * except those at a kept head. Never touches the repositories' own working trees. Never rejects.
   */
  readonly prune: (keep: readonly WorktreeKeep[]) => Promise<void>;
}

interface Assignment {
  readonly repository: GitRepository;
  readonly path: string;
}

/** Creates the worktree manager. It holds only in-memory bookkeeping; git holds the rest. */
export function createSessionWorktrees(options: SessionWorktreesOptions): SessionWorktrees {
  const { root, logger } = options;
  const creating = new Map<string, Promise<Result<string, GitError>>>();
  const assignments = new Map<string, Assignment>();
  let pruning: Promise<void> | undefined;

  const create = async (
    repository: GitRepository,
    headSha: CommitSha,
  ): Promise<Result<string, GitError>> => {
    const key = `${repository.root}\0${headSha}`;
    const pending = creating.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const started = performance.now();
    const adding = (async (): Promise<Result<string, GitError>> => {
      const added = await addWorktree(repository, { root, commit: headSha });
      if (added.ok) {
        logger.debug('worktree ready', {
          path: added.value.path,
          durationMs: Math.round(performance.now() - started),
        });
      }
      return added.ok ? ok(added.value.path) : added;
    })();
    creating.set(key, adding);
    try {
      return await adding;
    } finally {
      creating.delete(key);
    }
  };

  const release = async (previous: Assignment): Promise<void> => {
    for (const assignment of assignments.values()) {
      if (assignment.path === previous.path) {
        return;
      }
    }
    const removed = await removeWorktree(previous.repository, previous.path, { force: true });
    if (!removed.ok) {
      logger.warn('could not remove an outdated worktree', {
        path: previous.path,
        error: removed.error,
      });
    }
  };

  return {
    ensure: async (repository, sessionId, headSha): Promise<Result<string, GitError>> => {
      await pruning;
      const created = await create(repository, headSha);
      if (!created.ok) {
        return created;
      }
      const previous = assignments.get(sessionId);
      assignments.set(sessionId, { repository, path: created.value });
      if (previous !== undefined && previous.path !== created.value) {
        await release(previous);
      }
      return created;
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
  };
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
