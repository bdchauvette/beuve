import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** Commits reachable from `to` but not from `from`, such as work on a branch beyond its base. */
export interface CommitSpan {
  readonly from: CommitSha;
  readonly to: CommitSha;
}

/** How many commits `to` has that `from` hasn't (`git rev-list --count from..to`). `read`. */
export async function countCommits(
  repository: GitRepository,
  { from, to }: CommitSpan,
): Promise<Result<number, GitError>> {
  const args = ['rev-list', '--count', '--end-of-options', `${from}..${to}`];
  const output = await repository[gitRunner].run(args, { policy: { kind: 'read' } });
  if (!output.ok) {
    return output;
  }
  const count = Number(output.value.trim());
  if (!Number.isSafeInteger(count) || count < 0) {
    return err({ kind: 'unexpected-output', args, message: output.value });
  }
  return ok(count);
}
