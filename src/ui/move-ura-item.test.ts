import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { moveUraItem } from './move-ura-item.ts';

function all(): Set<string> {
  return new Set(['a', 'b', 'c', 'd']);
}

describe('moveUraItem', () => {
  test('swaps an item with its neighbour in either direction', ({ expect }) => {
    expect(moveUraItem(['a', 'b', 'c'], 'b', 1, all())).toStrictEqual(['a', 'c', 'b']);
    expect(moveUraItem(['a', 'b', 'c'], 'b', -1, all())).toStrictEqual(['b', 'a', 'c']);
  });

  test('stays put at the ends and for unknown or unmovable items', ({ expect }) => {
    expect(moveUraItem(['a', 'b'], 'b', 1, all())).toStrictEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], 'a', -1, all())).toStrictEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], 'z', 1, all())).toStrictEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], 'a', 1, new Set(['b']))).toStrictEqual(['a', 'b']);
  });

  test('skips items that are not movable, leaving them in place', ({ expect }) => {
    expect(moveUraItem(['a', 'x', 'b', 'c'], 'a', 1, new Set(['a', 'b', 'c']))).toStrictEqual([
      'b',
      'x',
      'a',
      'c',
    ]);
    expect(moveUraItem(['a', 'x'], 'a', 1, new Set(['a']))).toStrictEqual(['a', 'x']);
  });
});
