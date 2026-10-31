import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { convertRange } from './convert-range.ts';
import { LineIndex } from './line-index.ts';
import { positionEncodings } from './position-encodings.ts';

describe('convertRange', () => {
  test('converts each end against its own line of a CRLF document with astral characters', ({
    expect,
  }) => {
    const lines = new LineIndex('const s = "😀";\r\nlet é = s;\r\n');
    const range = { start: { line: 0, character: 11 }, end: { line: 1, character: 5 } };
    expect(
      convertRange(range, lines, { from: positionEncodings.utf16, to: positionEncodings.utf8 }),
    ).toStrictEqual({
      start: { line: 0, character: 11 },
      end: { line: 1, character: 6 },
    });
    const afterEmoji = { start: { line: 0, character: 15 }, end: { line: 0, character: 15 } };
    expect(
      convertRange(afterEmoji, lines, {
        from: positionEncodings.utf8,
        to: positionEncodings.utf16,
      }),
    ).toStrictEqual({
      start: { line: 0, character: 13 },
      end: { line: 0, character: 13 },
    });
  });

  test('returns the range untouched for matching encodings or an unknown document', ({
    expect,
  }) => {
    const range = { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } };
    expect(
      convertRange(range, new LineIndex('😀😀'), {
        from: positionEncodings.utf16,
        to: positionEncodings.utf16,
      }),
    ).toBe(range);
    expect(
      convertRange(range, undefined, { from: positionEncodings.utf8, to: positionEncodings.utf16 }),
    ).toBe(range);
  });
});
