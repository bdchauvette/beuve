import type { PositionEncoding } from './lsp-protocol.ts';
import { positionEncodings } from './position-encodings.ts';

/** The encoding positions are written in, and the one to re-express them in. */
export interface EncodingChange {
  readonly from: PositionEncoding;
  readonly to: PositionEncoding;
}

/**
 * Re-expresses a column of `lineText` (terminator excluded) from one position encoding in another.
 * A column past the end of the line clamps to the end, as LSP specifies; one that falls inside a
 * character (between UTF-8 bytes or UTF-16 surrogates) snaps to that character's start.
 */
export function convertCharacter(
  lineText: string,
  character: number,
  { from, to }: EncodingChange,
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
    index += unitsOf(codePoint, positionEncodings.utf16);
  }
  return target;
}

function unitsOf(codePoint: number, encoding: PositionEncoding): number {
  switch (encoding) {
    case positionEncodings.utf16: {
      if (codePoint > 0xff_ff) {
        return 2;
      }
      return 1;
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
      if (codePoint < 0x1_00_00) {
        return 3;
      }
      return 4;
    }
  }
}
