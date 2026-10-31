import type { DatabaseSync } from 'node:sqlite';

import type { EditSuggestion } from './review-edit-branch.ts';

/** Records (or replaces) which item a harvested edit became, and the content it carried. */
export function recordEditSuggestion(db: DatabaseSync, suggestion: EditSuggestion): void {
  db.prepare(
    `INSERT INTO review_edit_suggestions (session_id, head_sha, target, item_id, fingerprint)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (session_id, head_sha, target)
      DO UPDATE SET item_id = excluded.item_id, fingerprint = excluded.fingerprint;`,
  ).run(
    suggestion.sessionId,
    suggestion.headSha,
    suggestion.target,
    suggestion.itemId,
    suggestion.fingerprint,
  );
}
