import { describe, expect, it } from 'vitest';

import { convertRange } from './convert-range.ts';
import { LineIndex } from './line-index.ts';
import { positionEncodings } from './position-encodings.ts';

describe('convertRange', () => {
  it('converts each end against its own line of a CRLF document with astral characters', () => {
    const lines = new LineIndex('const s = "😀";\r\nlet é = s;\r\n');
    const range = { start: { line: 0, character: 11 }, end: { line: 1, character: 5 } };
    expect(convertRange(range, lines, positionEncodings.utf16, positionEncodings.utf8)).toEqual({
      start: { line: 0, character: 11 },
      end: { line: 1, character: 6 },
    });
    const afterEmoji = { start: { line: 0, character: 15 }, end: { line: 0, character: 15 } };
    expect(
      convertRange(afterEmoji, lines, positionEncodings.utf8, positionEncodings.utf16),
    ).toEqual({
      start: { line: 0, character: 13 },
      end: { line: 0, character: 13 },
    });
  });

  it('returns the range untouched for matching encodings or an unknown document', () => {
    const range = { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } };
    expect(
      convertRange(range, new LineIndex('😀😀'), positionEncodings.utf16, positionEncodings.utf16),
    ).toBe(range);
    expect(convertRange(range, undefined, positionEncodings.utf8, positionEncodings.utf16)).toBe(
      range,
    );
  });
});
