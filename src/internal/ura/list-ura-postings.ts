import type { DatabaseSync } from 'node:sqlite';

import { isCommitSha } from '#git/is-commit-sha.ts';
import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import type { SessionId, UraItemId } from './ura-item.ts';
import type { UraPosting, UraPostingPiece, UraPostingPlacement } from './ura-posting.ts';

/** The session's postings, oldest first. Rows that don't validate are skipped, never cast. */
export function listUraPostings(db: DatabaseSync, sessionId: SessionId): UraPosting[] {
  const rows = db
    .prepare(
      `SELECT item_id, target, piece, position, url, head_sha, placement, posted_at
         FROM ura_item_postings
        WHERE session_id = ? ORDER BY posted_at, rowid;`,
    )
    .all(sessionId);
  return rows.flatMap((row): UraPosting[] => {
    const { item_id: itemId, target, url, head_sha: headSha, placement, posted_at: postedAt } = row;
    const piece = pieceFrom(row);
    if (
      target === 'github' &&
      piece !== undefined &&
      typeof url === 'string' &&
      typeof postedAt === 'string' &&
      isPlacement(placement) &&
      isUuid(itemId) &&
      isCommitSha(headSha) &&
      isIsoTimestamp(postedAt)
    ) {
      return [
        {
          itemId: itemId as UraItemId,
          sessionId,
          target,
          piece,
          url,
          headSha,
          placement,
          postedAt,
        },
      ];
    }
    return [];
  });
}

/** The piece a row names, from its `piece` and `position` columns. */
function pieceFrom(row: Readonly<Record<string, unknown>>): UraPostingPiece | undefined {
  const { piece: kind, position } = row;
  if (kind === 'note' && position === 0) {
    return { kind: 'note' };
  }
  if (kind === 'suggestion' && typeof position === 'number' && Number.isSafeInteger(position)) {
    return { kind: 'suggestion', position };
  }
  return undefined;
}

function isPlacement(value: unknown): value is UraPostingPlacement {
  const placements: readonly unknown[] = ['comment', 'suggestion-comment', 'body'];
  return placements.includes(value);
}
