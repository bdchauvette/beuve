import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { moveUraItem } from './move-ura-item.ts';

function all(): Set<string> {
  return new Set(['a', 'b', 'c', 'd']);
}

describe('moveUraItem', () => {
  test('swaps an item with its neighbour in either direction', ({ expect }) => {
    expect(moveUraItem(['a', 'b', 'c'], { id: 'b', step: 1, movable: all() })).toStrictEqual([
      'a',
      'c',
      'b',
    ]);
    expect(moveUraItem(['a', 'b', 'c'], { id: 'b', step: -1, movable: all() })).toStrictEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('stays put at the ends and for unknown or unmovable items', ({ expect }) => {
    expect(moveUraItem(['a', 'b'], { id: 'b', step: 1, movable: all() })).toStrictEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], { id: 'a', step: -1, movable: all() })).toStrictEqual([
      'a',
      'b',
    ]);
    expect(moveUraItem(['a', 'b'], { id: 'z', step: 1, movable: all() })).toStrictEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], { id: 'a', step: 1, movable: new Set(['b']) })).toStrictEqual([
      'a',
      'b',
    ]);
  });

  test('skips items that are not movable, leaving them in place', ({ expect }) => {
    expect(
      moveUraItem(['a', 'x', 'b', 'c'], { id: 'a', step: 1, movable: new Set(['a', 'b', 'c']) }),
    ).toStrictEqual(['b', 'x', 'a', 'c']);
    expect(moveUraItem(['a', 'x'], { id: 'a', step: 1, movable: new Set(['a']) })).toStrictEqual([
      'a',
      'x',
    ]);
  });
});
