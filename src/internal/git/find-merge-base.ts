import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';

/**
 * The best common ancestor of two commits (the first one git picks when there are several),
 * or `no-merge-base` for unrelated histories.
 */
export async function findMergeBase(
  repository: GitRepository,
  [left, right]: readonly [CommitSha, CommitSha],
): Promise<Result<CommitSha, GitError>> {
  const args = ['merge-base', '--end-of-options', left, right];
  const output = await repository[gitRunner].run(args, { policy: { kind: 'read' } });
  if (!output.ok) {
    const { error } = output;
    if (error.kind === 'command-failed' && error.exitCode === 1 && error.stderr === '') {
      return err({ kind: 'no-merge-base', left, right });
    }
    return output;
  }
  const sha = parseCommitSha(output.value.trim());
  if (sha === undefined) {
    return err({ kind: 'unexpected-output', args, message: `not an object name: ${output.value}` });
  }
  return ok(sha);
}
