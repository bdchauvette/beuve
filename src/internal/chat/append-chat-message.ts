import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatMessage, ChatStoreError } from './chat-message.ts';
import { sqliteErrorCode } from '#x/sqlite/sqlite-error-code.ts';

const foreignKeyViolation = 787;
const primaryKeyViolation = 1555;

/** Stores a new message at the end of its session's transcript. */
export function appendChatMessage(
  db: DatabaseSync,
  message: ChatMessage,
): Result<void, Extract<ChatStoreError, { kind: 'session-not-found' | 'duplicate-message' }>> {
  const status = message.role === 'assistant' ? message.status : 'complete';
  const errorCode =
    message.role === 'assistant' && message.status === 'failed' ? message.errorCode : '';
  const kind = message.role === 'assistant' ? message.kind : 'answer';
  const review =
    message.role === 'assistant' && message.review !== undefined
      ? JSON.stringify(message.review)
      : '';
  try {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, citations, mentions,
                                  status, error_code, kind, review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?);`,
    ).run(
      message.id,
      message.sessionId,
      message.headSha,
      message.role,
      message.content,
      JSON.stringify(message.citations),
      JSON.stringify(message.mentions),
      status,
      errorCode,
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
