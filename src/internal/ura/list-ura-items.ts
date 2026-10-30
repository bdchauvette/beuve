import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { uraItemFromRow } from './ura-item-from-row.ts';
import type { SessionId, UraItem, UraStoreError } from './ura-item.ts';

/** A session's items in dock order, every status and every head. */
export function listUraItems(
  db: DatabaseSync,
  sessionId: SessionId,
): Result<UraItem[], Extract<UraStoreError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare('SELECT * FROM ura_items WHERE session_id = ? ORDER BY position, rowid;')
    .all(sessionId);
  const items: UraItem[] = [];
  for (const row of rows) {
    const item = uraItemFromRow(row);
    if (!item.ok) {
      return item;
    }
    items.push(item.value);
  }
  return ok(items);
}
