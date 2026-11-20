import { describe } from 'vitest';

import type { UraItemView } from '#contract/ipc-contract.ts';

import { dockItemOf } from './dock-item-of.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('dockItemOf', () => {
  test('has nothing without a cursor item', ({ expect }) => {
    expect(dockItemOf([])).toBeUndefined();
  });

  test('says whether the item is addressed, withdrawn or blocking', ({ expect }) => {
    expect(dockItemOf([createUraItemView()])).toStrictEqual({
      count: 1,
      isAddressed: false,
      isWithdrawn: false,
      isBlocking: false,
      status: 'staged',
      severity: 'issue',
    });
    expect(dockItemOf([addressed()])).toMatchObject({ isAddressed: true, isWithdrawn: false });
    expect(dockItemOf([withdrawn()])).toMatchObject({ isAddressed: false, isWithdrawn: true });
    expect(dockItemOf([createUraItemView({ blocking: true })])).toMatchObject({
      isBlocking: true,
    });
  });

  test('says so of a selection only when every note in it is', ({ expect }) => {
    expect(dockItemOf([withdrawn(), withdrawn()])).toStrictEqual({
      count: 2,
      isAddressed: false,
      isWithdrawn: true,
      isBlocking: false,
      status: 'withdrawn',
      severity: 'issue',
    });
    expect(
      dockItemOf([
        withdrawn(),
        createUraItemView({ blocking: true, severity: 'nitpick' }),
        addressed(),
      ]),
    ).toStrictEqual({ count: 3, isAddressed: false, isWithdrawn: false, isBlocking: false });
  });
});

function addressed(): UraItemView {
  return createUraItemView({
    status: { kind: 'addressed', atSha: 'a'.repeat(40), by: 'reviewer' },
  });
}

function withdrawn(): UraItemView {
  return createUraItemView({ status: { kind: 'withdrawn' } });
}
