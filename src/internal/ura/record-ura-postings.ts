import type { DatabaseSync } from 'node:sqlite';

import { withTransaction } from '#sqlite/with-transaction.ts';

import type { UraPosting } from './ura-posting.ts';

/**
 * Records that a posted review carried these pieces of notes, in one transaction. Posting a piece
 * to the same target again replaces its record with the newer posting.
 */
export function recordUraPostings(db: DatabaseSync, postings: readonly UraPosting[]): void {
  const insert = db.prepare(
    `INSERT INTO ura_item_postings
       (item_id, target, piece, position, session_id, url, head_sha, placement, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (item_id, target, piece, position) DO UPDATE SET
       url = excluded.url, head_sha = excluded.head_sha, placement = excluded.placement,
       posted_at = excluded.posted_at;`,
  );
  withTransaction(db, () => {
    for (const posting of postings) {
      let position = 0;
      if (posting.piece.kind === 'suggestion') {
        position = posting.piece.position;
      }
      insert.run(
        posting.itemId,
        posting.target,
        posting.piece.kind,
        position,
        posting.sessionId,
        posting.url,
        posting.headSha,
        posting.placement,
        posting.postedAt,
      );
    }
  });
}
