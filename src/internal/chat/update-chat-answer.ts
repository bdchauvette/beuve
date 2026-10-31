import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  AssistantState,
  ChatMessageId,
  ChatPart,
  ChatStoreError,
  Citation,
} from './chat-message.ts';
import type { ChatReview } from './chat-review.ts';

/** The new state of an assistant answer: a streaming preview, or its final state. */
export type ChatAnswerUpdate = AssistantState & {
  readonly parts: readonly ChatPart[];
  readonly citations?: readonly Citation[];
  /** A completed `/review`'s findings (ADR 0055). */
  readonly review?: ChatReview;
};

/**
 * Replaces an assistant answer's parts, citations, status and findings, e.g. with the parts so
 * far while it streams, then with the validated answer. Only assistant messages can be updated.
 */
export function updateChatAnswer(
  db: DatabaseSync,
  id: ChatMessageId,
  update: ChatAnswerUpdate,
): Result<void, Extract<ChatStoreError, { kind: 'message-not-found' }>> {
  const changed = db
    .prepare(
      `UPDATE chat_messages SET parts = ?, citations = ?, status = ?, review = NULLIF(?, '')
        WHERE id = ? AND role = 'assistant';`,
    )
    .run(
      JSON.stringify(update.parts),
      JSON.stringify(update.citations ?? []),
      update.status,
      update.review === undefined ? '' : JSON.stringify(update.review),
      id,
    );
  if (Number(changed.changes) === 1) {
    return ok(undefined);
  }
  return err({ kind: 'message-not-found', id });
}
