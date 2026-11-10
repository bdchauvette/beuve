import type { LinkColumns } from './link-offsets-in.ts';
import type { SelectionNeedle } from './selection-needle-from.ts';

const wordCharacter = /^[\p{L}\p{N}_$]$/u;

/**
 * Where `needle` occurs in `line`, left to right and not overlapping, at most `limit` of them: the
 * offsets a selection's other occurrences are highlighted at (ADR 0126). Case matters. A whole-word
 * needle skips occurrences inside a longer word.
 */
export function needleOffsetsIn(
  line: string,
  needle: SelectionNeedle,
  limit: number,
): LinkColumns[] {
  const offsets: LinkColumns[] = [];
  const { length } = needle.text;
  let start = line.indexOf(needle.text);
  while (start !== -1 && offsets.length < limit) {
    const end = start + length;
    if (!needle.isWholeWord || isBounded(line, { start, end })) {
      offsets.push({ start, end });
      start = line.indexOf(needle.text, end);
    } else {
      start = line.indexOf(needle.text, start + 1);
    }
  }
  return offsets;
}

function isBounded(line: string, span: LinkColumns): boolean {
  return (
    !wordCharacter.test(line.charAt(span.start - 1)) && !wordCharacter.test(line.charAt(span.end))
  );
}
