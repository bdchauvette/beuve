import type { DatabaseSync } from 'node:sqlite';

import { withTransaction } from '#sqlite/with-transaction.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { CheckpointId, SessionError, SessionId } from './session.ts';

type DeleteCheckpointError = Extract<
  SessionError,
  { kind: 'checkpoint-not-found' } | { kind: 'checkpoint-superseded' }
>;

/**
 * Undoes a Save Progress (ADR 0142): deletes the checkpoint if it is still the session's latest,
 * so the review state falls back to the one before it. Nothing references a checkpoint but a
 * range choice naming it, which goes with it. A later checkpoint makes it `checkpoint-superseded`.
 */
export function deleteLatestCheckpoint(
  db: DatabaseSync,
  sessionId: SessionId,
  checkpointId: CheckpointId,
): Result<void, DeleteCheckpointError> {
  return withTransaction(db, (): Result<void, DeleteCheckpointError> => {
    const owned = db
      .prepare('SELECT 1 FROM checkpoints WHERE id = ? AND session_id = ?;')
      .get(checkpointId, sessionId);
    if (owned === undefined) {
      return err({ kind: 'checkpoint-not-found', checkpointId });
    }
    const latest = db
      .prepare(
        `SELECT id FROM checkpoints WHERE session_id = ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1;`,
      )
      .get(sessionId);
    if (latest?.['id'] !== checkpointId) {
      return err({ kind: 'checkpoint-superseded', checkpointId });
    }
    db.prepare('DELETE FROM checkpoints WHERE id = ?;').run(checkpointId);
    return ok(undefined);
  });
}
