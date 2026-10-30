import { andThen } from '#x/result/and-then.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

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
    const now = Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
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
