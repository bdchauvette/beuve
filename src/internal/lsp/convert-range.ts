import { convertCharacter } from './convert-character.ts';
import type { EncodingChange } from './convert-character.ts';
import type { LineIndex } from './line-index.ts';
import type { LspPosition, LspRange } from './lsp-protocol.ts';

/**
 * Re-expresses `range` from one position encoding in another using the document's lines. Without
 * the document (`lines` undefined) or when the encodings match, the range is returned unchanged.
 */
export function convertRange(
  range: LspRange,
  lines: LineIndex | undefined,
  encodings: EncodingChange,
): LspRange {
  if (lines === undefined || encodings.from === encodings.to) {
    return range;
  }
  const convert = ({ line, character }: LspPosition): LspPosition => {
    return {
      line,
      character: convertCharacter(lines.lineText(line), character, encodings),
    };
  };
  return { start: convert(range.start), end: convert(range.end) };
}
