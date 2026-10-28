import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { GitError } from './git-error.ts';
import type { GitRepository } from './open-repository.ts';
import { parseWorktreeList } from './parse-worktree-list.ts';
import type { Worktree } from './parse-worktree-list.ts';

/** Every worktree of the repository, the main one first. */
export async function listWorktrees(
  repository: GitRepository,
): Promise<Result<readonly Worktree[], GitError>> {
  const args = ['worktree', 'list', '--porcelain', '-z'];
  const output = await repository.run(args);
  if (!output.ok) {
    return output;
  }
  const worktrees = parseWorktreeList(output.value);
  return worktrees === undefined
    ? err({ kind: 'unexpected-output', args, message: 'malformed worktree list' })
    : ok(worktrees);
}
