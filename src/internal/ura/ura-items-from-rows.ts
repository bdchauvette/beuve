import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { uraItemFromRow } from './ura-item-from-row.ts';
import type { UraItem, UraStoreError } from './ura-item.ts';

/** `ura_items` rows as items, each with its suggestions read in position order. */
export function uraItemsFromRows(
  db: DatabaseSync,
  rows: readonly Record<string, SQLOutputValue>[],
): Result<UraItem[], Extract<UraStoreError, { kind: 'corrupt-row' }>> {
  const select = db.prepare(
    'SELECT * FROM ura_item_suggestions WHERE item_id = ? ORDER BY position;',
  );
  const items: UraItem[] = [];
  for (const row of rows) {
    const item = uraItemFromRow(row, select.all(String(row['id'])));
    if (!item.ok) {
      return item;
    }
    items.push(item.value);
  }
  return ok(items);
}
