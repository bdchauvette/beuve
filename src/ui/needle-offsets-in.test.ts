import { describe } from 'vitest';

import { needleOffsetsIn } from './needle-offsets-in.ts';
import { test } from './testing/test.ts';

describe('needleOffsetsIn', () => {
  test('finds every occurrence of text anywhere, case-sensitively', ({ expect }) => {
    const needle = { text: 'id', isWholeWord: false };
    expect(needleOffsetsIn('userId = id + ID + idle', needle, 10)).toStrictEqual([
      { start: 9, end: 11 },
      { start: 19, end: 21 },
    ]);
    expect(needleOffsetsIn('a.b(a.b)', { text: 'a.b', isWholeWord: false }, 10)).toStrictEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  test('finds a whole word only where it stands alone', ({ expect }) => {
    const needle = { text: 'id', isWholeWord: true };
    expect(needleOffsetsIn('id(userId, id_2, $id, id)', needle, 10)).toStrictEqual([
      { start: 0, end: 2 },
      { start: 22, end: 24 },
    ]);
  });

  test('looks again just past an occurrence inside a word', ({ expect }) => {
    expect(needleOffsetsIn('aaa aa', { text: 'aa', isWholeWord: true }, 10)).toStrictEqual([
      { start: 4, end: 6 },
    ]);
  });

  test('does not overlap occurrences', ({ expect }) => {
    expect(needleOffsetsIn('aaaa', { text: 'aa', isWholeWord: false }, 10)).toStrictEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  test('stops at the limit', ({ expect }) => {
    expect(needleOffsetsIn('ab ab ab', { text: 'ab', isWholeWord: true }, 2)).toHaveLength(2);
    expect(needleOffsetsIn('ab ab ab', { text: 'ab', isWholeWord: true }, 0)).toStrictEqual([]);
  });
});
