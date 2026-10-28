import type { DatabaseSync } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { Session, SessionError } from './session.ts';

/** Persists the head and `updatedAt` of a session changed by {@link advanceHead}. */
export function updateSessionHead(
  db: DatabaseSync,
  session: Session,
): Result<void, Extract<SessionError, { kind: 'session-not-found' }>> {
  const { changes } = db
    .prepare('UPDATE sessions SET head_sha = ?, updated_at = ? WHERE id = ?;')
    .run(session.headSha, session.updatedAt, session.id);
  return Number(changes) === 0
    ? err({ kind: 'session-not-found', sessionId: session.id })
    : ok(undefined);
}
