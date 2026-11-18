import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { moveUraItems } from './move-ura-items.ts';

function all(): Set<string> {
  return new Set(['a', 'b', 'c', 'd']);
}

describe('moveUraItems', () => {
  test('swaps an item with its neighbor in either direction', ({ expect }) => {
    expect(moveUraItems(['a', 'b', 'c'], { ids: ['b'], step: 1, movable: all() })).toStrictEqual([
      'a',
      'c',
      'b',
    ]);
    expect(moveUraItems(['a', 'b', 'c'], { ids: ['b'], step: -1, movable: all() })).toStrictEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('stays put at the ends and for unknown or unmovable items', ({ expect }) => {
    expect(moveUraItems(['a', 'b'], { ids: ['b'], step: 1, movable: all() })).toStrictEqual([
      'a',
      'b',
    ]);
    expect(moveUraItems(['a', 'b'], { ids: ['a'], step: -1, movable: all() })).toStrictEqual([
      'a',
      'b',
    ]);
    expect(moveUraItems(['a', 'b'], { ids: ['z'], step: 1, movable: all() })).toStrictEqual([
      'a',
      'b',
    ]);
    expect(
      moveUraItems(['a', 'b'], { ids: ['a'], step: 1, movable: new Set(['b']) }),
    ).toStrictEqual(['a', 'b']);
  });

  test('skips items that are not movable, leaving them in place', ({ expect }) => {
    expect(
      moveUraItems(['a', 'x', 'b', 'c'], {
        ids: ['a'],
        step: 1,
        movable: new Set(['a', 'b', 'c']),
      }),
    ).toStrictEqual(['b', 'x', 'a', 'c']);
    expect(
      moveUraItems(['a', 'x'], { ids: ['a'], step: 1, movable: new Set(['a']) }),
    ).toStrictEqual(['a', 'x']);
  });

  test('moves several items together, a block as one', ({ expect }) => {
    expect(
      moveUraItems(['a', 'b', 'c', 'd'], { ids: ['b', 'c'], step: -1, movable: all() }),
    ).toStrictEqual(['b', 'c', 'a', 'd']);
    expect(
      moveUraItems(['a', 'b', 'c', 'd'], { ids: ['a', 'c'], step: 1, movable: all() }),
    ).toStrictEqual(['b', 'a', 'd', 'c']);
  });

  test('keeps one at an end there while the others close up behind it', ({ expect }) => {
    expect(
      moveUraItems(['a', 'b', 'c', 'd'], { ids: ['a', 'c'], step: -1, movable: all() }),
    ).toStrictEqual(['a', 'c', 'b', 'd']);
  });
});
