import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { withTransaction } from '#sqlite/with-transaction.ts';

import type { SessionId, UraItemId, UraStoreError } from './ura-item.ts';

/**
 * Puts a session's items in the given order. `ids` must name every item of the session exactly
 * once (withdrawn and addressed ones included), so a stale dock can't silently drop items;
 * otherwise nothing changes and the result is `order-mismatch`.
 */
export function reorderUraItems(
  db: DatabaseSync,
  sessionId: SessionId,
  ids: readonly UraItemId[],
): Result<void, Extract<UraStoreError, { kind: 'order-mismatch' }>> {
  return withTransaction(db, () => {
    const stored = db
      .prepare('SELECT id FROM ura_items WHERE session_id = ?;')
      .all(sessionId)
      .map((row) => String(row['id']));
    const wanted = new Set<string>(ids);
    if (
      wanted.size !== ids.length ||
      wanted.size !== stored.length ||
      stored.some((id) => !wanted.has(id))
    ) {
      return err({ kind: 'order-mismatch', sessionId });
    }
    const update = db.prepare('UPDATE ura_items SET position = ? WHERE id = ?;');
    for (const [position, id] of ids.entries()) {
      update.run(position, id);
    }
    return ok(undefined);
  });
}
