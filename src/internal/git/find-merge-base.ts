import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';

/**
 * The best common ancestor of two commits (the first one git picks when there are several),
 * or `no-merge-base` for unrelated histories.
 */
export async function findMergeBase(
  repository: GitRepository,
  left: CommitSha,
  right: CommitSha,
): Promise<Result<CommitSha, GitError>> {
  const args = ['merge-base', '--end-of-options', left, right];
  const output = await repository.run(args);
  if (!output.ok) {
    const { error } = output;
    return error.kind === 'command-failed' && error.exitCode === 1 && error.stderr === ''
      ? err({ kind: 'no-merge-base', left, right })
      : output;
  }
  const sha = parseCommitSha(output.value.trim());
  return sha === undefined
    ? err({ kind: 'unexpected-output', args, message: `not an object name: ${output.value}` })
    : ok(sha);
}
