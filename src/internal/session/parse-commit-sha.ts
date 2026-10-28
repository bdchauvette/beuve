import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { CommitSha, SessionError } from './session.ts';

const fullSha = /^(?:[\da-f]{40}|[\da-f]{64})$/iu;

/** Accepts a full SHA-1 or SHA-256 commit id in either case and lowercases it. */
export function parseCommitSha(
  value: string,
): Result<CommitSha, Extract<SessionError, { kind: 'invalid-commit-sha' }>> {
  return fullSha.test(value)
    ? ok(value.toLowerCase() as CommitSha)
    : err({ kind: 'invalid-commit-sha', value });
}
