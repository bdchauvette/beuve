import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { CommitSha, Session, SessionError, SessionId } from './session.ts';

/** Why {@link updateSessionHead} stored nothing. */
export type HeadWriteError =
  | Extract<SessionError, { kind: 'session-not-found' }>
  /** Another writer moved the head after the caller read it (ADR 0079). */
  | {
      readonly kind: 'head-changed';
      readonly sessionId: SessionId;
      readonly expected: CommitSha;
      readonly stored: string;
    };

/**
 * Persists the head and `updatedAt` of a session changed by {@link advanceHead}, if the stored
 * head is still `expectedHeadSha`, the head the caller's observation started from: a
 * compare-and-swap, so a slower writer acting on an older observation can't move the head back.
 */
export function updateSessionHead(
  db: DatabaseSync,
  session: Session,
  expectedHeadSha: CommitSha,
): Result<void, HeadWriteError> {
  const { changes } = db
    .prepare('UPDATE sessions SET head_sha = ?, updated_at = ? WHERE id = ? AND head_sha = ?;')
    .run(session.headSha, session.updatedAt, session.id, expectedHeadSha);
  if (Number(changes) > 0) {
    return ok(undefined);
  }
  const row = db.prepare('SELECT head_sha FROM sessions WHERE id = ?;').get(session.id);
  const stored = row?.['head_sha'];
  if (typeof stored === 'string') {
    return err({ kind: 'head-changed', sessionId: session.id, expected: expectedHeadSha, stored });
  }
  return err({ kind: 'session-not-found', sessionId: session.id });
}
