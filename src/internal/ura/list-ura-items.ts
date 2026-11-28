import type { DatabaseSync } from 'node:sqlite';

import type { Result } from '#x/result/result.ts';

import { uraItemsFromRows } from './ura-items-from-rows.ts';
import type { SessionId, UraItem, UraStoreError } from './ura-item.ts';

/** A session's items in note order, every status and every head. */
export function listUraItems(
  db: DatabaseSync,
  sessionId: SessionId,
): Result<UraItem[], Extract<UraStoreError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare('SELECT * FROM ura_items WHERE session_id = ? ORDER BY position, rowid;')
    .all(sessionId);
  return uraItemsFromRows(db, rows);
}
