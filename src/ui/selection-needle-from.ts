/** The text to look for elsewhere, and whether only whole words of it count. */
export interface SelectionNeedle {
  readonly text: string;
  readonly isWholeWord: boolean;
}

/** A selection on one line of code: its text and the characters just outside it ('' at an end). */
export interface LineSelection {
  readonly text: string;
  readonly before: string;
  readonly after: string;
}

/** Longer selections are pasted blocks, not something to look for. */
const maxLength = 200;
const minVisible = 2;
const wordPattern = /^[\p{L}\p{N}_$]+$/u;
const visiblePattern = /\S/gu;
const lineBreakPattern = /[\n\r]/u;

/**
 * What to highlight for a selection (ADR 0126): nothing for a selection over several lines, one
 * longer than 200 characters, or one with fewer than two visible characters. A selection that is a
 * whole word (word characters, with none just outside it) matches only whole words; any other
 * matches anywhere, as editors do.
 */
export function selectionNeedleFrom(selection: LineSelection): SelectionNeedle | undefined {
  const { text, before, after } = selection;
  const visible = text.match(visiblePattern)?.length ?? 0;
  if (text.length > maxLength || lineBreakPattern.test(text) || visible < minVisible) {
    return undefined;
  }
  const isWholeWord = wordPattern.test(text) && !isWordCharacter(before) && !isWordCharacter(after);
  return { text, isWholeWord };
}

function isWordCharacter(character: string): boolean {
  return wordPattern.test(character);
}
