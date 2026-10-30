import type { DatabaseSync } from 'node:sqlite';

import type { ChatMessageId, SessionId } from './chat-message.ts';

/**
 * Deletes some of a session's messages, e.g. the questions and answers still queued when the
 * reviewer clears the queue (ADR 0057); returns how many were removed.
 */
export function deleteChatMessages(
  db: DatabaseSync,
  sessionId: SessionId,
  ids: readonly ChatMessageId[],
): number {
  const remove = db.prepare('DELETE FROM chat_messages WHERE session_id = ? AND id = ?;');
  let removed = 0;
  for (const id of ids) {
    removed += Number(remove.run(sessionId, id).changes);
  }
  return removed;
}
