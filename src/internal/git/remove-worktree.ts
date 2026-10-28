import path from 'node:path';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { GitError } from './git-error.ts';
import type { GitRepository } from './open-repository.ts';

export interface RemoveWorktreeOptions {
  /** Also remove a worktree with local modifications or untracked files. */
  readonly force?: boolean;
}

/** Removes a linked worktree and its administrative files. Never the main worktree. */
export async function removeWorktree(
  repository: GitRepository,
  worktreePath: string,
  options: RemoveWorktreeOptions = {},
): Promise<Result<undefined, GitError>> {
  if (!path.isAbsolute(worktreePath)) {
    return err({
      kind: 'invalid-argument',
      argument: worktreePath,
      reason: 'path must be absolute',
    });
  }
  if (path.resolve(worktreePath) === path.resolve(repository.root)) {
    return err({
      kind: 'invalid-argument',
      argument: worktreePath,
      reason: 'cannot remove the main worktree',
    });
  }
  const force = options.force === true ? ['--force'] : [];
  const removed = await repository.run([
    'worktree',
    'remove',
    ...force,
    '--end-of-options',
    worktreePath,
  ]);
  return removed.ok ? ok(undefined) : removed;
}
