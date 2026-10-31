import { removeTree } from '#x/fs/remove-tree.ts';

import { listWorktrees } from './list-worktrees.ts';
import type { GitRepository } from './open-repository.ts';
import { pruneWorktrees } from './prune-worktrees.ts';

/**
 * Drops what a failed `worktree add` left at `target`, unless git registered it after all: the
 * directory (reopened first if it was made read-only), then git's record of it.
 */
export async function removeFailedAdd(repository: GitRepository, target: string): Promise<void> {
  const worktrees = await listWorktrees(repository);
  const isRegistered = worktrees.ok && worktrees.value.some((worktree) => worktree.path === target);
  if (isRegistered) {
    return;
  }
  await removeTree(target);
  await pruneWorktrees(repository);
}
