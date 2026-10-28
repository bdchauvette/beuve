import { andThen } from '#pkg/result/and-then.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { parseSessionSource } from './parse-session-source.ts';
import type {
  CommitSha,
  SessionDeps,
  SessionError,
  SessionId,
  SessionSource,
  UnreviewedSession,
} from './session.ts';
import { systemSessionDeps } from './system-session-deps.ts';

/** Starts an unreviewed session for `source`, currently at `headSha`. */
export function createSession(
  source: SessionSource,
  headSha: CommitSha,
  deps: SessionDeps = systemSessionDeps,
): Result<UnreviewedSession, Extract<SessionError, { kind: 'invalid-source' }>> {
  return andThen(parseSessionSource(source), (valid) => {
    const now = deps.now().toISOString();
    return ok({
      id: deps.newId() as SessionId,
      source: valid,
      headSha,
      review: { kind: 'unreviewed' },
      createdAt: now,
      updatedAt: now,
    });
  });
}
