import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRepository } from './open-repository.ts';

/** Drops git's records of worktrees whose directories no longer exist. `atomic` (ADR 0079). */
export async function pruneWorktrees(
  repository: GitRepository,
): Promise<Result<undefined, GitError>> {
  const pruned = await repository[gitRunner].run(['worktree', 'prune'], {
    policy: { kind: 'atomic' },
  });
  if (pruned.ok) {
    return ok(undefined);
  }
  return pruned;
}
