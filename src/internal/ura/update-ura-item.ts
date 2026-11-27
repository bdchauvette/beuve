import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { withResultTransaction } from '#sqlite/with-result-transaction.ts';
import { uraItemRowFrom } from './ura-item-row-from.ts';
import type { UraItem, UraStoreError } from './ura-item.ts';
import { writeUraSuggestions } from './write-ura-suggestions.ts';

type ItemNotFound = Extract<UraStoreError, { kind: 'item-not-found' }>;

/**
 * Persists an item that `editUraItem` or a status action (`withdrawUraItem`,
 * `markUraItemAddressed`, `reopenUraItem`) produced: its label, blocking, text, suggestions,
 * status and `updatedAt`. Its identity, head, anchor, origin and position are not touched.
 */
export function updateUraItem(db: DatabaseSync, item: UraItem): Result<void, ItemNotFound> {
  return withResultTransaction(db, (): Result<void, ItemNotFound> => {
    const statement = db.prepare(
      `UPDATE ura_items
          SET severity = :severity, blocking = :blocking, title = :title, body = :body,
              status = :status, addressed_sha = :addressed_sha, addressed_by = :addressed_by,
              updated_at = :updated_at
        WHERE id = :id AND session_id = :session_id;`,
    );
    statement.setAllowUnknownNamedParameters(true);
    const { changes } = statement.run(uraItemRowFrom(item));
    if (Number(changes) === 0) {
      return err({ kind: 'item-not-found', id: item.id });
    }
    writeUraSuggestions(db, item);
    return ok(undefined);
  });
}
