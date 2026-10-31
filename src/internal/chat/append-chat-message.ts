import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatMessage, ChatStoreError } from './chat-message.ts';
import { sqliteErrorCode } from '#sqlite/sqlite-error-code.ts';

const foreignKeyViolation = 787;
const primaryKeyViolation = 1555;

/** Stores a new message at the end of its session's transcript. */
export function appendChatMessage(
  db: DatabaseSync,
  message: ChatMessage,
): Result<void, Extract<ChatStoreError, { kind: 'session-not-found' | 'duplicate-message' }>> {
  let status = 'done';
  let kind = 'answer';
  let review = '';
  if (message.role === 'assistant') {
    ({ status, kind } = message);
    if (message.review !== undefined) {
      review = JSON.stringify(message.review);
    }
  }
  try {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, parts, citations, status, kind,
                                  review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?);`,
    ).run(
      message.id,
      message.sessionId,
      message.headSha,
      message.role,
      JSON.stringify(message.parts),
      JSON.stringify(message.citations),
      status,
      kind,
      review,
      message.createdAt,
    );
  } catch (error: unknown) {
    switch (sqliteErrorCode(error)) {
      case foreignKeyViolation: {
        return err({ kind: 'session-not-found', sessionId: message.sessionId });
      }
      case primaryKeyViolation: {
        return err({ kind: 'duplicate-message', id: message.id });
      }
      default: {
        throw error;
      }
    }
  }
  return ok(undefined);
}
