import { describe, expect, it } from 'vitest';

import { moveUraItem } from './move-ura-item.ts';

const all = new Set(['a', 'b', 'c', 'd']);

describe('moveUraItem', () => {
  it('swaps an item with its neighbour in either direction', () => {
    expect(moveUraItem(['a', 'b', 'c'], 'b', 1, all)).toEqual(['a', 'c', 'b']);
    expect(moveUraItem(['a', 'b', 'c'], 'b', -1, all)).toEqual(['b', 'a', 'c']);
  });

  it('stays put at the ends and for unknown or unmovable items', () => {
    expect(moveUraItem(['a', 'b'], 'b', 1, all)).toEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], 'a', -1, all)).toEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], 'z', 1, all)).toEqual(['a', 'b']);
    expect(moveUraItem(['a', 'b'], 'a', 1, new Set(['b']))).toEqual(['a', 'b']);
  });

  it('skips items that are not movable, leaving them in place', () => {
    expect(moveUraItem(['a', 'x', 'b', 'c'], 'a', 1, new Set(['a', 'b', 'c']))).toEqual([
      'b',
      'x',
      'a',
      'c',
    ]);
    expect(moveUraItem(['a', 'x'], 'a', 1, new Set(['a']))).toEqual(['a', 'x']);
  });
});
