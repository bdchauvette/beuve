import type { DatabaseSync } from 'node:sqlite';

import type { UraItem } from './ura-item.ts';

/**
 * Replaces an item's `ura_item_suggestions` rows with its suggestions, in order. Runs inside the
 * caller's transaction, after the item's own row exists.
 */
export function writeUraSuggestions(db: DatabaseSync, item: UraItem): void {
  db.prepare('DELETE FROM ura_item_suggestions WHERE item_id = ?;').run(item.id);
  const insert = db.prepare(
    `INSERT INTO ura_item_suggestions (item_id, position, path, start_line, end_line, replacement)
     VALUES (?, ?, ?, ?, ?, ?);`,
  );
  for (const [position, suggestion] of item.suggestions.entries()) {
    insert.run(
      item.id,
      position,
      suggestion.path,
      suggestion.startLine,
      suggestion.endLine,
      suggestion.replacement,
    );
  }
}
