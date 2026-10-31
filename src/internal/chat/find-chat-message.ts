import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatMessage, ChatMessageId, ChatStoreError } from './chat-message.ts';
import { chatMessageFromRow } from './chat-message-from-row.ts';

/** One stored message by id, e.g. the `/review` answer a finding is staged from (ADR 0055). */
export function findChatMessage(
  db: DatabaseSync,
  id: ChatMessageId,
): Result<ChatMessage, Extract<ChatStoreError, { kind: 'message-not-found' | 'corrupt-row' }>> {
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?;').get(id);
  if (row === undefined) {
    return err({ kind: 'message-not-found', id });
  }
  return chatMessageFromRow(row);
}
