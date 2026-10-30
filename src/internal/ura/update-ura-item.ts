import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { uraItemRowFrom } from './ura-item-row-from.ts';
import type { UraItem, UraStoreError } from './ura-item.ts';

/**
 * Persists an item that `editUraItem` or `transitionUraItem` produced: its severity, text,
 * patch, status and `updatedAt`. Its identity, head, anchor, origin and position are not touched.
 */
export function updateUraItem(
  db: DatabaseSync,
  item: UraItem,
): Result<void, Extract<UraStoreError, { kind: 'item-not-found' }>> {
  const statement = db.prepare(
    `UPDATE ura_items
        SET severity = :severity, title = :title, body = :body, patch = :patch,
            status = :status, addressed_sha = :addressed_sha, addressed_by = :addressed_by,
            updated_at = :updated_at
      WHERE id = :id AND session_id = :session_id;`,
  );
  statement.setAllowUnknownNamedParameters(true);
  const { changes } = statement.run(uraItemRowFrom(item));
  return Number(changes) === 0 ? err({ kind: 'item-not-found', id: item.id }) : ok(undefined);
}
