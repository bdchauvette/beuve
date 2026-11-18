import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { checkpointFromRow } from './checkpoint-from-row.ts';
import type { ReviewRangeChoice, SessionError, SessionId } from './session.ts';

type CorruptRow = Extract<SessionError, { kind: 'corrupt-row' }>;

/** The range the reviewer chose for a session's review (ADR 0140); `since-last` when none is stored. */
export function findReviewRangeChoice(
  db: DatabaseSync,
  sessionId: SessionId,
): Result<ReviewRangeChoice, CorruptRow> {
  const row = db
    .prepare(
      `SELECT r.kind, r.checkpoint_id AS chosen_id,
              c.id AS checkpoint_id, c.session_id AS checkpoint_session_id,
              c.base_sha AS checkpoint_base_sha, c.head_sha AS checkpoint_head_sha,
              c.created_at AS checkpoint_created_at
         FROM review_ranges AS r
         LEFT JOIN checkpoints AS c ON c.id = r.checkpoint_id AND c.session_id = r.session_id
        WHERE r.session_id = ?;`,
    )
    .get(sessionId);
  if (row === undefined) {
    return ok({ kind: 'since-last' });
  }
  const corrupt = (reason: string): Result<ReviewRangeChoice, CorruptRow> => {
    return err({ kind: 'corrupt-row', table: 'review_ranges', id: sessionId, reason });
  };
  switch (row['kind']) {
    case 'whole': {
      return ok({ kind: 'whole' });
    }
    case 'since-checkpoint': {
      if (row['checkpoint_id'] === null) {
        return corrupt('checkpoint_id is not a checkpoint of this session');
      }
      const checkpoint = checkpointFromRow(row);
      if (!checkpoint.ok) {
        return checkpoint;
      }
      return ok({ kind: 'since-checkpoint', checkpoint: checkpoint.value });
    }
    default: {
      return corrupt('kind is not a review range');
    }
  }
}
