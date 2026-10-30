import type { ChatMessageView } from '#contract/ipc-contract.ts';
import type { ChatMessage } from '#internal/chat/chat-message.ts';

import { chatPartViewFrom } from './chat-part-view-from.ts';

/** The renderer's view of a stored message (ADR 0072). */
export function chatMessageViewFrom(message: ChatMessage): ChatMessageView {
  const base = {
    id: message.id,
    sessionId: message.sessionId,
    headSha: message.headSha,
    role: message.role,
    parts: message.parts.map((part) => chatPartViewFrom(part)),
    citations: message.citations.map(({ path, startLine, endLine }) => ({
      path,
      startLine,
      endLine,
    })),
    createdAt: message.createdAt,
  };
  if (message.role !== 'assistant') {
    return { ...base, status: 'done' };
  }
  return {
    ...base,
    status: message.status,
    answerKind: message.kind,
    ...(message.review !== undefined && { review: message.review }),
  };
}
