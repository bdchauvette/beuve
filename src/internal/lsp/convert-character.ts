import type { PositionEncoding } from './lsp-protocol.ts';
import { positionEncodings } from './position-encodings.ts';

/**
 * Re-expresses a column of `lineText` (terminator excluded) from one position encoding in another.
 * A column past the end of the line clamps to the end, as LSP specifies; one that falls inside a
 * character (between UTF-8 bytes or UTF-16 surrogates) snaps to that character's start.
 */
export function convertCharacter(
  lineText: string,
  character: number,
  from: PositionEncoding,
  to: PositionEncoding,
): number {
  let source = 0;
  let target = 0;
  let index = 0;
  while (index < lineText.length && source < character) {
    const codePoint = lineText.codePointAt(index) ?? 0;
    const sourceUnits = unitsOf(codePoint, from);
    if (source + sourceUnits > character) {
      return target;
    }
    source += sourceUnits;
    target += unitsOf(codePoint, to);
    index += codePoint > 0xff_ff ? 2 : 1;
  }
  return target;
}

function unitsOf(codePoint: number, encoding: PositionEncoding): number {
  switch (encoding) {
    case positionEncodings.utf16: {
      return codePoint > 0xff_ff ? 2 : 1;
    }
    case positionEncodings.utf32: {
      return 1;
    }
    case positionEncodings.utf8: {
      if (codePoint < 0x80) {
        return 1;
      }
      if (codePoint < 0x8_00) {
        return 2;
      }
      return codePoint < 0x1_00_00 ? 3 : 4;
    }
  }
}
