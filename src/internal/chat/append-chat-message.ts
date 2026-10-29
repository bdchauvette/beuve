import type { DatabaseSync } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { ChatMessage, ChatStoreError } from './chat-message.ts';
import { sqliteErrorCode } from './sqlite-error-code.ts';

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
  try {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, citations, mentions,
                                  status, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?);`,
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
