import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { uraItemsFromRows } from './ura-items-from-rows.ts';
import type { UraItem, UraItemId, UraStoreError } from './ura-item.ts';

/** One item by id, whatever its status. */
export function findUraItem(
  db: DatabaseSync,
  id: UraItemId,
): Result<UraItem, Extract<UraStoreError, { kind: 'item-not-found' | 'corrupt-row' }>> {
  const row = db.prepare('SELECT * FROM ura_items WHERE id = ?;').get(id);
  if (row === undefined) {
    return err({ kind: 'item-not-found', id });
  }
  const items = uraItemsFromRows(db, [row]);
  if (!items.ok) {
    return items;
  }
  const [item] = items.value;
  if (item === undefined) {
    return err({ kind: 'item-not-found', id });
  }
  return ok(item);
}
