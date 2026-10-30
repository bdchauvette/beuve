import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRepository } from './open-repository.ts';

export interface RemoveWorktreeOptions {
  /** Also remove a worktree with local modifications or untracked files. */
  readonly force?: boolean;
}

/** Deleting a large checkout can take longer than git's default timeout. */
const removalTimeout = Temporal.Duration.from({ minutes: 10 });

/**
 * Removes a linked worktree and its administrative files. Never the main worktree. `atomic`
 * (ADR 0079): a removal stopped halfway would leave the worktree registered with files missing,
 * which an add would then hand out as is, so an abort lets it finish and reports `aborted`.
 */
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
  const removed = await repository[gitRunner].exec(
    ['worktree', 'remove', ...force, '--end-of-options', worktreePath],
    { policy: { kind: 'atomic' }, timeout: removalTimeout },
  );
  return removed.ok ? ok(undefined) : removed;
}
