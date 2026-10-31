import type { DatabaseSync } from 'node:sqlite';

import type { CommitSha, EditSuggestion, SessionId } from './review-edit-branch.ts';

/** A session and the head its harvested edits were written against. */
export interface HarvestScope {
  readonly sessionId: string;
  readonly headSha: string;
}

/** The items earlier harvests of this session made at this head, by target. */
export function listEditSuggestions(
  db: DatabaseSync,
  { sessionId, headSha }: HarvestScope,
): ReadonlyMap<string, EditSuggestion> {
  const rows = db
    .prepare('SELECT * FROM review_edit_suggestions WHERE session_id = ? AND head_sha = ?;')
    .all(sessionId, headSha);
  const found = new Map<string, EditSuggestion>();
  for (const row of rows) {
    const { target, item_id, fingerprint } = row;
    if (
      typeof target === 'string' &&
      typeof item_id === 'string' &&
      typeof fingerprint === 'string'
    ) {
      found.set(target, {
        sessionId: sessionId as SessionId,
        headSha: headSha as CommitSha,
        target,
        itemId: item_id,
        fingerprint,
      });
    }
  }
  return found;
}
