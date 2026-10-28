import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { GitError } from './git-error.ts';
import type { GitRepository } from './open-repository.ts';

/** Drops git's records of worktrees whose directories no longer exist. */
export async function pruneWorktrees(
  repository: GitRepository,
): Promise<Result<undefined, GitError>> {
  const pruned = await repository.run(['worktree', 'prune']);
  return pruned.ok ? ok(undefined) : pruned;
}
