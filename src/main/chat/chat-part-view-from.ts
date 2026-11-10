import type { ChatErrorCode, ChatPartView } from '#contract/ipc-contract.ts';
import type { ChatPart } from '#internal/chat/chat-message.ts';

import { describeChatError } from './describe-chat-error.ts';
import { noteLabelFrom } from './note-label-from.ts';

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
 * as `internal`, and an error part says what to do. A proposed note whose label is no longer a
 * note label reads as dropped for it (ADR 0132).
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
    case 'proposal': {
      const label = noteLabelFrom(part.note.label);
      if (label === undefined) {
        return { kind: 'dropped-proposal', id: part.id, reason: 'unknown-label' };
      }
      return { ...part, note: { ...part.note, label } };
    }
    case 'error': {
      let code: ChatErrorCode = 'internal';
      if (isErrorCode(part.code)) {
        code = part.code;
      }
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
