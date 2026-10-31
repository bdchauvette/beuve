import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { convertCharacter } from './convert-character.ts';
import type { PositionEncoding } from './lsp-protocol.ts';
import { positionEncodings } from './position-encodings.ts';

/** a (1 byte), é (2 bytes), € (3 bytes), 😀 (4 bytes, a surrogate pair), z. */
function line(): string {
  return 'aé€😀z';
}

function boundaries(): Readonly<Record<PositionEncoding, readonly number[]>> {
  return {
    [positionEncodings.utf8]: [0, 1, 3, 6, 10, 11],
    [positionEncodings.utf16]: [0, 1, 2, 3, 5, 6],
    [positionEncodings.utf32]: [0, 1, 2, 3, 4, 5],
  };
}

function encodings(): readonly PositionEncoding[] {
  return [positionEncodings.utf8, positionEncodings.utf16, positionEncodings.utf32];
}

describe('convertCharacter', () => {
  test('maps every character boundary between every pair of encodings', ({ expect }) => {
    for (const from of encodings()) {
      for (const to of encodings()) {
        const expected = boundaries()[to];
        const actual = boundaries()[from].map((column) => {
          return convertCharacter(line(), column, { from: from, to: to });
        });
        expect(actual, `${from} -> ${to}`).toStrictEqual(expected);
      }
    }
  });

  test('snaps columns inside a character to its start', ({ expect }) => {
    expect(
      convertCharacter(line(), 4, { from: positionEncodings.utf16, to: positionEncodings.utf8 }),
    ).toBe(6);
    expect(
      convertCharacter(line(), 8, { from: positionEncodings.utf8, to: positionEncodings.utf16 }),
    ).toBe(3);
    expect(
      convertCharacter(line(), 2, { from: positionEncodings.utf8, to: positionEncodings.utf32 }),
    ).toBe(1);
  });

  test('clamps columns past the end of the line', ({ expect }) => {
    expect(
      convertCharacter(line(), 99, { from: positionEncodings.utf16, to: positionEncodings.utf8 }),
    ).toBe(11);
    expect(
      convertCharacter('', 5, { from: positionEncodings.utf8, to: positionEncodings.utf16 }),
    ).toBe(0);
  });

  test('counts a lone surrogate as one UTF-16 unit and three UTF-8 bytes', ({ expect }) => {
    const lone = 'x\u{D800}y';
    expect(
      convertCharacter(lone, 2, { from: positionEncodings.utf16, to: positionEncodings.utf8 }),
    ).toBe(4);
    expect(
      convertCharacter(lone, 4, { from: positionEncodings.utf8, to: positionEncodings.utf16 }),
    ).toBe(2);
  });
});
