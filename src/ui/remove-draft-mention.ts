import type { DraftPart, DraftState } from './chat-draft.ts';
import { draftLength } from './draft-length.ts';

/**
 * Backspace (`backward`) or Delete (`forward`) next to a chip removes the whole chip; `undefined`
 * when the character on that side of the caret is text, which the editor deletes itself. Pure.
 */
export function removeDraftMention(
  state: DraftState,
  direction: 'backward' | 'forward',
): DraftState | undefined {
  let target = state.caret;
  if (direction === 'backward') {
    target -= 1;
  }
  let position = 0;
  for (const [index, part] of state.parts.entries()) {
    const length = draftLength([part]);
    if (target >= position && target < position + length) {
      if (part.kind !== 'mention') {
        return undefined;
      }
      const parts = joinText([...state.parts.slice(0, index), ...state.parts.slice(index + 1)]);
      return { parts, caret: position };
    }
    position += length;
  }
  return undefined;
}

function joinText(parts: readonly DraftPart[]): DraftPart[] {
  const joined: DraftPart[] = [];
  for (const part of parts) {
    const last = joined.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') {
      joined[joined.length - 1] = { kind: 'text', text: last.text + part.text };
    } else {
      joined.push(part);
    }
  }
  return joined;
}
