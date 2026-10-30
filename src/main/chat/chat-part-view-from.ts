import type { ChatErrorCode, ChatPartView } from '#contract/ipc-contract.ts';
import type { ChatPart } from '#internal/chat/chat-message.ts';

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

/**
 * The renderer's view of a stored or streamed part (ADR 0072); an unknown stored error code reads
 * as `internal`, and an error part says what to do.
 */
export function chatPartViewFrom(part: ChatPart): ChatPartView {
  switch (part.kind) {
    case 'mention': {
      const { path, side, startLine, endLine, sha } = part.mention;
      return {
        ...part,
        mention: {
          path,
          side,
          ...(startLine !== undefined && endLine !== undefined && { startLine, endLine }),
          sha,
        },
      };
    }
    case 'error': {
      const code = isErrorCode(part.code) ? part.code : 'internal';
      return { kind: 'error', id: part.id, code, message: describeChatError(code) };
    }
    default: {
      return part;
    }
  }
}

function isErrorCode(code: string): code is ChatErrorCode {
  return errorCodes.has(code);
}
