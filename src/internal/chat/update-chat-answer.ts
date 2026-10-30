import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AssistantState, ChatMessageId, ChatStoreError, Citation } from './chat-message.ts';

/** The new content of an assistant answer: a streaming preview, or its final state. */
export type ChatAnswerUpdate = AssistantState & {
  readonly content: string;
  readonly citations?: readonly Citation[];
};

/**
 * Replaces an assistant answer's content, citations and status, e.g. with the partial text while
 * it streams, then with the validated answer. Only assistant messages can be updated.
 */
export function updateChatAnswer(
  db: DatabaseSync,
  id: ChatMessageId,
  update: ChatAnswerUpdate,
): Result<void, Extract<ChatStoreError, { kind: 'message-not-found' }>> {
  const changed = db
    .prepare(
      `UPDATE chat_messages SET content = ?, citations = ?, status = ?, error_code = NULLIF(?, '')
        WHERE id = ? AND role = 'assistant';`,
    )
    .run(
      update.content,
      JSON.stringify(update.citations ?? []),
      update.status,
      update.status === 'failed' ? update.errorCode : '',
      id,
    );
  return Number(changed.changes) === 1 ? ok(undefined) : err({ kind: 'message-not-found', id });
}
