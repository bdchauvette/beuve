import type { DatabaseSync } from 'node:sqlite';

import { openRepository } from '#internal/git/open-repository.ts';
import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { pruneWorktrees } from '#internal/git/prune-worktrees.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { removeTree } from '#x/fs/remove-tree.ts';
import type { Logger } from '#x/log/create-logger.ts';

import { moveDatabaseAside } from './move-database-aside.ts';
import type { MovedDatabase } from './move-database-aside.ts';

export interface ResetDatabaseOptions {
  /** The open app database. It is closed here, and never opened again by this call. */
  readonly db: DatabaseSync;
  /** Its file, `<userData>/beuve.db`. */
  readonly location: string;
  /** The sessions' read-only checkouts (ADR 0020), `<userData>/worktrees`. */
  readonly worktreeRoot: string;
  /** How the repositories are opened to prune their worktree records. */
  readonly git?: OpenRepositoryOptions;
  readonly logger: Logger;
}

/** What a reset did: where the database went, and which repositories forgot the checkouts. */
export interface DatabaseReset {
  /** `undefined` when there was no database file to move. */
  readonly moved: MovedDatabase | undefined;
  /** The sessions' repositories whose `git worktree` records of the removed checkouts were pruned. */
  readonly prunedRepositories: readonly string[];
}

/**
 * Resets beuve to a clean slate (ADR 0136), with every service that uses the database or a
 * checkout already stopped: reads which repositories the sessions are in, closes `db` and moves
 * its files aside (`moveDatabaseAside`, never deleted), removes every checkout under
 * `worktreeRoot`, then runs `git worktree prune` in each of those repositories so none keeps a
 * record of a checkout that is gone. The review-edits worktrees, their branches and the
 * repositories' own working trees are left alone. Prune failures are logged, not thrown; a failed
 * move throws before anything is removed.
 */
export async function resetDatabase(options: ResetDatabaseOptions): Promise<DatabaseReset> {
  const { logger } = options;
  const repositories = sessionRepositories(options.db, logger);
  options.db.close();
  const moved = await moveDatabaseAside(options.location);
  if (moved === undefined) {
    logger.warn('no database file to move aside', { location: options.location });
  } else {
    logger.info('moved the database aside', { path: moved.path, files: moved.files });
  }
  await removeTree(options.worktreeRoot);
  logger.info('removed the session checkouts', { root: options.worktreeRoot });
  const prunedRepositories: string[] = [];
  for (const repoPath of repositories) {
    const outcome = await pruneRepository(repoPath, options);
    if (outcome === 'pruned') {
      prunedRepositories.push(repoPath);
    }
  }
  return { moved, prunedRepositories };
}

/**
 * The distinct repositories of the stored sessions, read before the database closes. A database
 * too broken to list them answers none: the records git keeps of the removed checkouts then wait
 * for the next `git worktree prune`, which beuve runs at startup in every session's repository.
 */
function sessionRepositories(db: DatabaseSync, logger: Logger): readonly string[] {
  try {
    const sessions = listSessions(db);
    if (!sessions.ok) {
      logger.warn('could not list the sessions to prune their repositories', {
        error: sessions.error,
      });
      return [];
    }
    return [...new Set(sessions.value.map((session) => session.source.repoPath))];
  } catch (error: unknown) {
    logger.warn('could not list the sessions to prune their repositories', {
      error: errorFrom(error),
    });
    return [];
  }
}

async function pruneRepository(
  repoPath: string,
  options: ResetDatabaseOptions,
): Promise<'pruned' | 'skipped'> {
  const { logger } = options;
  const repository = await openRepository(repoPath, options.git);
  if (!repository.ok) {
    logger.info('skipping worktree pruning for an unavailable repository', { repoPath });
    return 'skipped';
  }
  const pruned = await pruneWorktrees(repository.value);
  if (!pruned.ok) {
    logger.warn('could not prune worktree records', { repoPath, error: pruned.error });
    return 'skipped';
  }
  return 'pruned';
}
