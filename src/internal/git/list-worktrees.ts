import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRepository } from './open-repository.ts';
import { parseWorktreeList } from './parse-worktree-list.ts';
import type { Worktree } from './parse-worktree-list.ts';

/** Every worktree of the repository, the main one first. */
export async function listWorktrees(
  repository: GitRepository,
): Promise<Result<readonly Worktree[], GitError>> {
  const args = ['worktree', 'list', '--porcelain', '-z'];
  const output = await repository[gitRunner].run(args, { policy: { kind: 'read' } });
  if (!output.ok) {
    return output;
  }
  const worktrees = parseWorktreeList(output.value);
  if (worktrees === undefined) {
    return err({ kind: 'unexpected-output', args, message: 'malformed worktree list' });
  }
  return ok(worktrees);
}
