import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { uraItemFromRow } from './ura-item-from-row.ts';
import type { UraItem, UraStoreError } from './ura-item.ts';

/**
 * The stored item a `duplicate-item` insert collided with: the one staged from the same `/review`
 * finding (answer and index, ADR 0055), or from the same ImpactGate finding (session, head, path, metric and function), in
 * whatever status. `undefined` for other origins or when there is none.
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
  } else if (origin.kind === 'impact-finding' && item.anchor.kind === 'lines') {
    row = db
      .prepare(
        `SELECT * FROM ura_items
          WHERE origin_kind = 'impact-finding' AND session_id = ? AND head_sha = ? AND path = ?
            AND impact_metric = ? AND impact_function = ?;`,
      )
      .get(item.sessionId, item.headSha, item.anchor.path, origin.metric, origin.functionName);
  }
  return row === undefined ? ok(undefined) : uraItemFromRow(row);
}
