import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { UraItemId, UraStoreError } from './ura-item.ts';

/**
 * Removes an item, whatever its status. Its postings and review-edit bindings go with it (they
 * cascade), and a `/review` finding or proposed note it came from can be staged again.
 */
export function deleteUraItem(
  db: DatabaseSync,
  id: UraItemId,
): Result<void, Extract<UraStoreError, { kind: 'item-not-found' }>> {
  const { changes } = db.prepare('DELETE FROM ura_items WHERE id = ?;').run(id);
  if (changes === 0) {
    return err({ kind: 'item-not-found', id });
  }
  return ok(undefined);
}
