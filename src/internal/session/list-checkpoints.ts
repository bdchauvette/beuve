import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { rowToCheckpoint } from './row-to-checkpoint.ts';
import type { Checkpoint, SessionError, SessionId } from './session.ts';

/** A session's checkpoints, oldest first: the revisions the reviewer has signed off on. */
export function listCheckpoints(
  db: DatabaseSync,
  sessionId: SessionId,
): Result<Checkpoint[], Extract<SessionError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare(
      `SELECT id AS checkpoint_id, session_id AS checkpoint_session_id,
              base_sha AS checkpoint_base_sha, head_sha AS checkpoint_head_sha,
              created_at AS checkpoint_created_at
         FROM checkpoints WHERE session_id = ? ORDER BY created_at, rowid;`,
    )
    .all(sessionId);
  const checkpoints: Checkpoint[] = [];
  for (const row of rows) {
    const checkpoint = rowToCheckpoint(row);
    if (!checkpoint.ok) {
      return checkpoint;
    }
    checkpoints.push(checkpoint.value);
  }
  return ok(checkpoints);
}
