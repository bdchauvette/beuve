import { describe } from 'vitest';

import { dropUraItems } from './drop-ura-items.ts';
import { test } from './testing/test.ts';

describe('dropUraItems', () => {
  test('puts a note before or after the one it is dropped on', ({ expect }) => {
    const movable = new Set(['a', 'b', 'c', 'd']);
    const order = ['a', 'b', 'c', 'd'];
    expect(
      dropUraItems(order, { ids: ['d'], targetId: 'b', side: 'before', movable }),
    ).toStrictEqual(['a', 'd', 'b', 'c']);
    expect(
      dropUraItems(order, { ids: ['a'], targetId: 'c', side: 'after', movable }),
    ).toStrictEqual(['b', 'c', 'a', 'd']);
  });

  test('lands several notes together, in their old order', ({ expect }) => {
    const movable = new Set(['a', 'b', 'c', 'd', 'e']);
    expect(
      dropUraItems(['a', 'b', 'c', 'd', 'e'], {
        ids: ['d', 'a'],
        targetId: 'e',
        side: 'after',
        movable,
      }),
    ).toStrictEqual(['b', 'c', 'e', 'a', 'd']);
  });

  test('keeps withdrawn and addressed notes where they are', ({ expect }) => {
    const movable = new Set(['a', 'c', 'e']);
    expect(
      dropUraItems(['a', 'w', 'c', 'x', 'e'], {
        ids: ['e', 'w'],
        targetId: 'a',
        side: 'before',
        movable,
      }),
    ).toStrictEqual(['e', 'w', 'a', 'x', 'c']);
  });

  test.for([
    ['an unmovable target', { ids: ['a'], targetId: 'w', side: 'before' }],
    ['a dragged target', { ids: ['a', 'c'], targetId: 'c', side: 'after' }],
    ['nothing movable dragged', { ids: ['w'], targetId: 'a', side: 'after' }],
    ['an unknown target', { ids: ['a'], targetId: 'z', side: 'after' }],
  ] as const)('leaves the order alone for %s', ([, drop], { expect }) => {
    const order = ['a', 'w', 'c'];
    expect(dropUraItems(order, { ...drop, movable: new Set(['a', 'c']) })).toStrictEqual(order);
  });
});
