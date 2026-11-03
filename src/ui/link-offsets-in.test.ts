import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { linkOffsetsIn } from './link-offsets-in.ts';

describe('linkOffsetsIn', () => {
  test('slices the identifier out of a merged element', ({ expect }) => {
    expect(linkOffsetsIn({ start: 9, end: 17 }, { start: 2, length: 20 })).toStrictEqual({
      start: 7,
      end: 15,
    });
  });

  test('clips an identifier that runs past either end of the element', ({ expect }) => {
    expect(linkOffsetsIn({ start: 3, end: 12 }, { start: 5, length: 4 })).toStrictEqual({
      start: 0,
      end: 4,
    });
  });

  test('has nothing when the element and the identifier share no text', ({ expect }) => {
    expect(linkOffsetsIn({ start: 0, end: 4 }, { start: 4, length: 3 })).toBeUndefined();
    expect(linkOffsetsIn({ start: 9, end: 12 }, { start: 4, length: 5 })).toBeUndefined();
    expect(linkOffsetsIn({ start: 4, end: 4 }, { start: 0, length: 9 })).toBeUndefined();
  });
});
