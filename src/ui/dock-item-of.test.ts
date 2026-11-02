import { describe } from 'vitest';

import { dockItemOf } from './dock-item-of.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('dockItemOf', () => {
  test('has nothing without a cursor item', ({ expect }) => {
    expect(dockItemOf(undefined)).toBeUndefined();
  });

  test('says whether the item is addressed', ({ expect }) => {
    const addressed = createUraItemView({
      status: { kind: 'addressed', atSha: 'a'.repeat(40), by: 'reviewer' },
    });
    expect(dockItemOf(createUraItemView())).toStrictEqual({ isAddressed: false });
    expect(dockItemOf(addressed)).toStrictEqual({ isAddressed: true });
  });
});
