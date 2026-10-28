import { convertCharacter } from './convert-character.ts';
import type { LineIndex } from './line-index.ts';
import type { LspRange, PositionEncoding } from './lsp-protocol.ts';

/**
 * Re-expresses `range` from one position encoding in another using the document's lines. Without
 * the document (`lines` undefined) or when the encodings match, the range is returned unchanged.
 */
export function convertRange(
  range: LspRange,
  lines: LineIndex | undefined,
  from: PositionEncoding,
  to: PositionEncoding,
): LspRange {
  if (lines === undefined || from === to) {
    return range;
  }
  const convert = (line: number, character: number): { line: number; character: number } => ({
    line,
    character: convertCharacter(lines.lineText(line), character, from, to),
  });
  return {
    start: convert(range.start.line, range.start.character),
    end: convert(range.end.line, range.end.character),
  };
}
