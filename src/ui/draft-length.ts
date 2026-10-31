import type { DraftPart } from './chat-draft.ts';

/** A draft's length in caret positions: its text, and one for each chip. Pure. */
export function draftLength(parts: readonly DraftPart[]): number {
  let length = 0;
  for (const part of parts) {
    if (part.kind === 'text') {
      length += part.text.length;
    } else {
      length += 1;
    }
  }
  return length;
}
