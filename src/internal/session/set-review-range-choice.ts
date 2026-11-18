import type { DatabaseSync } from 'node:sqlite';

import { withTransaction } from '#sqlite/with-transaction.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ReviewRangeSelection, SessionError, SessionId } from './session.ts';

type SetRangeError = Extract<
  SessionError,
  { kind: 'session-not-found' } | { kind: 'checkpoint-not-found' }
>;

/**
 * Stores which range the session's review shows (ADR 0141). `since-last`, the default, removes
 * the stored choice; `since-checkpoint` must name one of the session's own checkpoints.
 */
export function setReviewRangeChoice(
  db: DatabaseSync,
  sessionId: SessionId,
  selection: ReviewRangeSelection,
): Result<void, SetRangeError> {
  return withTransaction(db, (): Result<void, SetRangeError> => {
    const session = db.prepare('SELECT 1 FROM sessions WHERE id = ?;').get(sessionId);
    if (session === undefined) {
      return err({ kind: 'session-not-found', sessionId });
    }
    db.prepare('DELETE FROM review_ranges WHERE session_id = ?;').run(sessionId);
    switch (selection.kind) {
      case 'since-last': {
        return ok(undefined);
      }
      case 'whole': {
        db.prepare("INSERT INTO review_ranges (session_id, kind) VALUES (?, 'whole');").run(
          sessionId,
        );
        return ok(undefined);
      }
      case 'since-checkpoint': {
        const { checkpointId } = selection;
        const owned = db
          .prepare('SELECT 1 FROM checkpoints WHERE id = ? AND session_id = ?;')
          .get(checkpointId, sessionId);
        if (owned === undefined) {
          return err({ kind: 'checkpoint-not-found', checkpointId });
        }
        db.prepare(
          `INSERT INTO review_ranges (session_id, kind, checkpoint_id)
           VALUES (?, 'since-checkpoint', ?);`,
        ).run(sessionId, checkpointId);
        return ok(undefined);
      }
    }
  });
}
