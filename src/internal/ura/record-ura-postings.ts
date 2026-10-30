import type { DatabaseSync } from 'node:sqlite';

import { withTransaction } from '#sqlite/with-transaction.ts';

import type { UraPosting } from './ura-posting.ts';

/**
 * Records that a posted review carried these items, in one transaction. Posting an item to the
 * same target again replaces its record with the newer posting.
 */
export function recordUraPostings(db: DatabaseSync, postings: readonly UraPosting[]): void {
  const insert = db.prepare(
    `INSERT INTO ura_item_postings (item_id, target, session_id, url, head_sha, placement, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (item_id, target) DO UPDATE SET
       url = excluded.url, head_sha = excluded.head_sha, placement = excluded.placement,
       posted_at = excluded.posted_at;`,
  );
  withTransaction(db, () => {
    for (const posting of postings) {
      insert.run(
        posting.itemId,
        posting.target,
        posting.sessionId,
        posting.url,
        posting.headSha,
        posting.placement,
        posting.postedAt,
      );
    }
  });
}
