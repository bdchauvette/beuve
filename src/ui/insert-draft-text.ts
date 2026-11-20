import type { DraftPart, DraftState } from './chat-draft.ts';
import { draftLength } from './draft-length.ts';

/**
 * Types `text` at the caret, splitting a text run there or starting one beside a chip, and leaves
 * the caret after it. Adjacent text runs are merged. Pure.
 */
export function insertDraftText(state: DraftState, text: string): DraftState {
  const parts: DraftPart[] = [];
  let position = 0;
  let isInserted = false;
  for (const part of state.parts) {
    const length = draftLength([part]);
    if (!isInserted && part.kind === 'text' && state.caret <= position + length) {
      const cut = state.caret - position;
      parts.push({ kind: 'text', text: part.text.slice(0, cut) + text + part.text.slice(cut) });
      isInserted = true;
    } else {
      if (!isInserted && state.caret <= position) {
        parts.push({ kind: 'text', text });
        isInserted = true;
      }
      parts.push(part);
    }
    position += length;
  }
  if (!isInserted) {
    parts.push({ kind: 'text', text });
  }
  return { parts: mergeText(parts), caret: state.caret + text.length };
}

function mergeText(parts: readonly DraftPart[]): DraftPart[] {
  const merged: DraftPart[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') {
      merged[merged.length - 1] = { kind: 'text', text: last.text + part.text };
    } else {
      merged.push(part);
    }
  }
  return merged;
}
