import { describe } from 'vitest';

import { dockItemOf } from './dock-item-of.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('dockItemOf', () => {
  test('has nothing without a cursor item', ({ expect }) => {
    expect(dockItemOf([])).toBeUndefined();
  });

  test('says whether the item is addressed or withdrawn', ({ expect }) => {
    expect(dockItemOf([createUraItemView()])).toStrictEqual({
      count: 1,
      isAddressed: false,
      isWithdrawn: false,
    });
    expect(dockItemOf([addressed()])).toStrictEqual({
      count: 1,
      isAddressed: true,
      isWithdrawn: false,
    });
    expect(dockItemOf([withdrawn()])).toStrictEqual({
      count: 1,
      isAddressed: false,
      isWithdrawn: true,
    });
  });

  test('says so of a selection only when every note in it is', ({ expect }) => {
    expect(dockItemOf([withdrawn(), withdrawn()])).toStrictEqual({
      count: 2,
      isAddressed: false,
      isWithdrawn: true,
    });
    expect(dockItemOf([withdrawn(), createUraItemView(), addressed()])).toStrictEqual({
      count: 3,
      isAddressed: false,
      isWithdrawn: false,
    });
  });
});

function addressed(): ReturnType<typeof createUraItemView> {
  return createUraItemView({
    status: { kind: 'addressed', atSha: 'a'.repeat(40), by: 'reviewer' },
  });
}

function withdrawn(): ReturnType<typeof createUraItemView> {
  return createUraItemView({ status: { kind: 'withdrawn' } });
}
