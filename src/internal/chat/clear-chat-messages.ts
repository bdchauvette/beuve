import type { DatabaseSync } from 'node:sqlite';

import type { SessionId } from './chat-message.ts';

/** Deletes a session's whole transcript; returns how many messages were removed. */
export function clearChatMessages(db: DatabaseSync, sessionId: SessionId): number {
  const deleted = db.prepare('DELETE FROM chat_messages WHERE session_id = ?;').run(sessionId);
  return Number(deleted.changes);
}
