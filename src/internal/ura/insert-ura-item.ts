import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { sqliteErrorCode } from '#sqlite/sqlite-error-code.ts';
import { uraItemRowFrom } from './ura-item-row-from.ts';
import type { UraItem, UraStoreError } from './ura-item.ts';

const foreignKeyViolation = 787;
const primaryKeyViolation = 1555;
const uniqueViolation = 2067;

/**
 * Appends an item to the end of its session's dock. A `/review` finding can be staged once, and an
 * ImpactGate finding once per (session, head, path, function); a repeat is `duplicate-item`, so
 * main can find and restore the existing item instead.
 */
export function insertUraItem(
  db: DatabaseSync,
  item: UraItem,
): Result<void, Extract<UraStoreError, { kind: 'session-not-found' | 'duplicate-item' }>> {
  try {
    db.prepare(
      `INSERT INTO ura_items (id, session_id, position, head_sha, anchor_kind, path, line_start,
                              line_end, severity, origin_kind, chat_message_id, chat_finding,
                              impact_metric, impact_function, impact_value, impact_threshold,
                              impact_percentile, title, body, patch, status, addressed_sha,
                              addressed_by, created_at, updated_at)
       VALUES (:id, :session_id,
               (SELECT coalesce(max(position) + 1, 0) FROM ura_items WHERE session_id = :session_id),
               :head_sha, :anchor_kind, :path, :line_start, :line_end, :severity, :origin_kind,
               :chat_message_id, :chat_finding, :impact_metric, :impact_function, :impact_value,
               :impact_threshold, :impact_percentile, :title, :body, :patch, :status,
               :addressed_sha, :addressed_by, :created_at, :updated_at);`,
    ).run(uraItemRowFrom(item));
  } catch (error: unknown) {
    switch (sqliteErrorCode(error)) {
      case foreignKeyViolation: {
        return err({ kind: 'session-not-found', sessionId: item.sessionId });
      }
      case primaryKeyViolation: {
        return err({ kind: 'duplicate-item', id: item.id, reason: 'id-taken' });
      }
      case uniqueViolation: {
        const reason =
          item.origin.kind === 'chat-answer'
            ? 'review-finding-already-staged'
            : 'finding-already-staged';
        return err({ kind: 'duplicate-item', id: item.id, reason });
      }
      default: {
        throw error;
      }
    }
  }
  return ok(undefined);
}
