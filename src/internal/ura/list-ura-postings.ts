import type { DatabaseSync } from 'node:sqlite';

import { isCommitSha } from './is-commit-sha.ts';
import { isIsoTimestamp } from './is-iso-timestamp.ts';
import { isUuid } from './is-uuid.ts';
import type { SessionId, UraItemId } from './ura-item.ts';
import type { UraPosting } from './ura-posting.ts';

/** The session's postings, oldest first. Rows that don't validate are skipped, never cast. */
export function listUraPostings(db: DatabaseSync, sessionId: SessionId): UraPosting[] {
  const rows = db
    .prepare(
      `SELECT item_id, target, url, head_sha, placement, posted_at FROM ura_item_postings
        WHERE session_id = ? ORDER BY posted_at, rowid;`,
    )
    .all(sessionId);
  return rows.flatMap((row): UraPosting[] => {
    const { item_id: itemId, target, url, head_sha: headSha, placement, posted_at: postedAt } = row;
    const isPlacement = placement === 'inline' || placement === 'body';
    return target === 'github' &&
      isPlacement &&
      typeof url === 'string' &&
      typeof postedAt === 'string' &&
      isUuid(itemId) &&
      isCommitSha(headSha) &&
      isIsoTimestamp(postedAt)
      ? [{ itemId: itemId as UraItemId, sessionId, target, url, headSha, placement, postedAt }]
      : [];
  });
}
