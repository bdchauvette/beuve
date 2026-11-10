import type { ChatPartView } from '#contract/ipc-contract.ts';

import { describeMention } from './describe-mention.ts';

/**
 * What a message says as plain text (ADR 0072): its text parts in order, a mention as its chip's
 * label (`feature.rs:1-2`). A proposed note (ADR 0132), staged on its own, only separates the
 * text around it; reasoning, tool calls, findings and errors add nothing. Pure.
 */
export function chatTextFrom(parts: readonly ChatPartView[]): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case 'text': {
          return part.text;
        }
        case 'mention': {
          return describeMention(part.mention).label;
        }
        case 'proposal':
        case 'dropped-proposal': {
          return '\n\n';
        }
        default: {
          return '';
        }
      }
    })
    .join('');
}
