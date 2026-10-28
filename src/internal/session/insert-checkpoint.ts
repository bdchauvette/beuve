import type { DatabaseSync } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';
import { withTransaction } from '#pkg/sqlite/with-transaction.ts';

import type { Checkpoint, SessionError } from './session.ts';
import { sqliteErrorCode } from './sqlite-error-code.ts';

const foreignKeyViolation = 787;

/**
 * Persists a checkpoint from {@link recordCheckpoint} and bumps its session's `updated_at`,
 * atomically. The session's review state follows, since it is derived from checkpoints.
 */
export function insertCheckpoint(
  db: DatabaseSync,
  checkpoint: Checkpoint,
): Result<void, Extract<SessionError, { kind: 'session-not-found' }>> {
  try {
    withTransaction(db, () => {
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, commit_sha, created_at) VALUES (?, ?, ?, ?);',
      ).run(checkpoint.id, checkpoint.sessionId, checkpoint.commitSha, checkpoint.createdAt);
      db.prepare('UPDATE sessions SET updated_at = max(updated_at, ?) WHERE id = ?;').run(
        checkpoint.createdAt,
        checkpoint.sessionId,
      );
    });
  } catch (error: unknown) {
    if (sqliteErrorCode(error) === foreignKeyViolation) {
      return err({ kind: 'session-not-found', sessionId: checkpoint.sessionId });
    }
    throw error;
  }
  return ok(undefined);
}
