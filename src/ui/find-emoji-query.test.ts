import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { findEmojiQuery } from './find-emoji-query.ts';

describe('findEmojiQuery', () => {
  test('finds the colon and name before the caret, lowercased', ({ expect }) => {
    expect(findEmojiQuery({ text: 'Nice :Tad', caret: 9 })).toStrictEqual({
      start: 5,
      end: 9,
      name: 'tad',
    });
    expect(findEmojiQuery({ text: ':+1 later', caret: 3 })).toStrictEqual({
      start: 0,
      end: 3,
      name: '+1',
    });
    expect(findEmojiQuery({ text: 'line\n(:thumbs', caret: 13 })).toStrictEqual({
      start: 6,
      end: 13,
      name: 'thumbs',
    });
  });

  test('waits for two characters of a name', ({ expect }) => {
    expect(findEmojiQuery({ text: 'a :t', caret: 4 })).toBeUndefined();
    expect(findEmojiQuery({ text: 'a :', caret: 3 })).toBeUndefined();
  });

  test('ignores colons inside words, times, URLs and closed shortcodes', ({ expect }) => {
    for (const text of ['note:ab', '10:30', 'https://example', 'a::bc', ':tada: ', ':ab cd']) {
      expect(findEmojiQuery({ text, caret: text.length })).toBeUndefined();
    }
  });

  test('reads only what is before the caret', ({ expect }) => {
    expect(findEmojiQuery({ text: ':tada', caret: 3 })).toStrictEqual({
      start: 0,
      end: 3,
      name: 'ta',
    });
    expect(findEmojiQuery({ text: ':tada', caret: 0 })).toBeUndefined();
  });

  test('gives up on a run longer than any name', ({ expect }) => {
    const text = `:${'a'.repeat(60)}`;
    expect(findEmojiQuery({ text, caret: text.length })).toBeUndefined();
  });
});
