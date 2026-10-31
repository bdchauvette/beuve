import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { checkBranchName } from './check-branch-name.ts';
import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A local branch to delete, and the commit it must still point at. */
export interface BranchDeletion {
  readonly branch: string;
  readonly expected: CommitSha;
}

/**
 * Deletes a local branch only if it still points at `expected` (`git update-ref -d`, a
 * compare-and-swap): commits added since the caller looked are never lost. Answers
 * `branch-moved` (as `command-failed`) otherwise. Local refs only; nothing reaches a remote.
 * `atomic`: git's ref transaction either happens or doesn't.
 */
export async function deleteBranch(
  repository: GitRepository,
  { branch, expected }: BranchDeletion,
): Promise<Result<undefined, GitError>> {
  const checked = await checkBranchName(repository, branch);
  if (!checked.ok) {
    return checked;
  }
  if (checked.value !== branch) {
    return err({ kind: 'invalid-argument', argument: branch, reason: 'not a plain branch name' });
  }
  const deleted = await repository[gitRunner].run(
    ['update-ref', '-d', '--end-of-options', `refs/heads/${branch}`, expected],
    { policy: { kind: 'atomic' } },
  );
  if (deleted.ok) {
    return ok(undefined);
  }
  return deleted;
}
