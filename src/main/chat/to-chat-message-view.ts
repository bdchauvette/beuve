import type { ChatErrorCode, ChatMessageView } from '#contract/ipc-contract.ts';
import type { ChatMessage } from '#internal/chat/chat-message.ts';

import { describeChatError } from './describe-chat-error.ts';

const errorCodes: ReadonlySet<string> = new Set<ChatErrorCode>([
  'not-installed',
  'not-authenticated',
  'rate-limited',
  'timeout',
  'model-failed',
  'chat-unavailable',
  'nothing-to-review',
  'internal',
]);

/** The renderer's view of a stored message; an unknown stored error code reads as `internal`. */
export function toChatMessageView(message: ChatMessage): ChatMessageView {
  const base = {
    id: message.id,
    sessionId: message.sessionId,
    headSha: message.headSha,
    role: message.role,
    content: message.content,
    citations: message.citations.map(({ path, startLine, endLine }) => ({
      path,
      startLine,
      endLine,
    })),
    mentions: message.mentions.map(({ path, side, startLine, endLine, sha }) => ({
      path,
      side,
      ...(startLine !== undefined && endLine !== undefined && { startLine, endLine }),
      sha,
    })),
    createdAt: message.createdAt,
  };
  if (message.role !== 'assistant') {
    return { ...base, status: 'complete' };
  }
  const answer = {
    ...base,
    answerKind: message.kind,
    ...(message.review !== undefined && { review: message.review }),
  };
  if (message.status !== 'failed') {
    return { ...answer, status: message.status };
  }
  const errorCode = isErrorCode(message.errorCode) ? message.errorCode : 'internal';
  return { ...answer, status: 'failed', errorCode, errorMessage: describeChatError(errorCode) };
}

function isErrorCode(code: string): code is ChatErrorCode {
  return errorCodes.has(code);
}
