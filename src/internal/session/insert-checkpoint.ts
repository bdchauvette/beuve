import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { withTransaction } from '#sqlite/with-transaction.ts';

import type { Checkpoint, SessionError } from './session.ts';
import { sqliteErrorCode } from '#sqlite/sqlite-error-code.ts';

const foreignKeyViolation = 787;

/**
 * Persists a checkpoint from {@link recordCheckpoint} and bumps its session's `updated_at`,
 * atomically. The session's review state follows, since it is derived from checkpoints. A range
 * choice goes back to the default (ADR 0141): the next review shows what changes after this one.
 */
export function insertCheckpoint(
  db: DatabaseSync,
  checkpoint: Checkpoint,
): Result<void, Extract<SessionError, { kind: 'session-not-found' }>> {
  try {
    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO checkpoints (id, session_id, base_sha, head_sha, created_at)
         VALUES (?, ?, ?, ?, ?);`,
      ).run(
        checkpoint.id,
        checkpoint.sessionId,
        checkpoint.baseSha,
        checkpoint.headSha,
        checkpoint.createdAt,
      );
      db.prepare('UPDATE sessions SET updated_at = max(updated_at, ?) WHERE id = ?;').run(
        checkpoint.createdAt,
        checkpoint.sessionId,
      );
      db.prepare('DELETE FROM review_ranges WHERE session_id = ?;').run(checkpoint.sessionId);
    });
  } catch (error: unknown) {
    if (sqliteErrorCode(error) === foreignKeyViolation) {
      return err({ kind: 'session-not-found', sessionId: checkpoint.sessionId });
    }
    throw error;
  }
  return ok(undefined);
}
