import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatMessage, ChatStoreError, SessionId } from './chat-message.ts';
import { rowToChatMessage } from './row-to-chat-message.ts';

/** A session's transcript, oldest first (insertion order breaks timestamp ties). */
export function listChatMessages(
  db: DatabaseSync,
  sessionId: SessionId,
): Result<ChatMessage[], Extract<ChatStoreError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid;')
    .all(sessionId);
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    const message = rowToChatMessage(row);
    if (!message.ok) {
      return message;
    }
    messages.push(message.value);
  }
  return ok(messages);
}
