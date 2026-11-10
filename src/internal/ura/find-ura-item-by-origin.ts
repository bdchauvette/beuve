import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { uraItemFromRow } from './ura-item-from-row.ts';
import type { UraItem, UraStoreError } from './ura-item.ts';

/**
 * The stored item a `duplicate-item` insert collided with: the one staged from the same `/review`
 * finding (answer and index, ADR 0055) or proposed note (ADR 0132), in whatever status. `undefined` for other origins or when
 * there is none.
 */
export function findUraItemByOrigin(
  db: DatabaseSync,
  item: UraItem,
): Result<UraItem | undefined, Extract<UraStoreError, { kind: 'corrupt-row' }>> {
  const { origin } = item;
  let row: Record<string, SQLOutputValue> | undefined;
  if (origin.kind === 'chat-answer' && origin.finding !== undefined) {
    row = db
      .prepare('SELECT * FROM ura_items WHERE chat_message_id = ? AND chat_finding = ?;')
      .get(origin.messageId, origin.finding);
  } else if (origin.kind === 'chat-answer' && origin.proposal !== undefined) {
    row = db
      .prepare('SELECT * FROM ura_items WHERE chat_message_id = ? AND chat_proposal = ?;')
      .get(origin.messageId, origin.proposal);
  }
  if (row === undefined) {
    return ok(undefined);
  }
  return uraItemFromRow(row);
}
