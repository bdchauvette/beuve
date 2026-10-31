import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { CommitSha, SessionError } from './session.ts';

const fullSha = /^(?:[\da-f]{40}|[\da-f]{64})$/iu;

/**
 * Accepts a full SHA-1 or SHA-256 commit id in either case and lowercases it. A value that isn't
 * a string, such as a database column of another type, is reported as `''`.
 */
export function parseCommitSha(
  value: unknown,
): Result<CommitSha, Extract<SessionError, { kind: 'invalid-commit-sha' }>> {
  if (typeof value !== 'string') {
    return err({ kind: 'invalid-commit-sha', value: '' });
  }
  if (fullSha.test(value)) {
    return ok(value.toLowerCase() as CommitSha);
  }
  return err({ kind: 'invalid-commit-sha', value });
}
