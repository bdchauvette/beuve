import type { DatabaseSync } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import type { Result } from '#pkg/result/result.ts';

import { rowToUraItem } from './row-to-ura-item.ts';
import type { UraItem, UraItemId, UraStoreError } from './ura-item.ts';

/** One item by id, whatever its status. */
export function findUraItem(
  db: DatabaseSync,
  id: UraItemId,
): Result<UraItem, Extract<UraStoreError, { kind: 'item-not-found' | 'corrupt-row' }>> {
  const row = db.prepare('SELECT * FROM ura_items WHERE id = ?;').get(id);
  return row === undefined ? err({ kind: 'item-not-found', id }) : rowToUraItem(row);
}
