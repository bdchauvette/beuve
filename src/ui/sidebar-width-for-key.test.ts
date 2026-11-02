import { describe } from 'vitest';

import { sidebarWidthForKey } from './sidebar-width-for-key.ts';
import { test } from './testing/test.ts';

describe('sidebarWidthForKey', () => {
  test.for([
    ['right', 'ArrowLeft', false, 416],
    ['right', 'ArrowRight', false, 384],
    ['right', 'ArrowLeft', true, 464],
    ['right', 'ArrowRight', true, 336],
    ['left', 'ArrowRight', false, 416],
    ['left', 'ArrowLeft', false, 384],
  ] as const)(
    'on the %s, %s (shift %s) gives %i from 400',
    ([side, key, isShift, expected], { expect }) => {
      expect(sidebarWidthForKey({ key, isShift, side, current: 400, available: 1600 })).toBe(
        expected,
      );
    },
  );

  test('ignores keys that do not resize', ({ expect }) => {
    expect(
      sidebarWidthForKey({
        key: 'ArrowUp',
        isShift: false,
        side: 'right',
        current: 400,
        available: 1600,
      }),
    ).toBeUndefined();
  });

  test('stops at the limits', ({ expect }) => {
    expect(
      sidebarWidthForKey({
        key: 'ArrowRight',
        isShift: true,
        side: 'right',
        current: 250,
        available: 1600,
      }),
    ).toBe(240);
    expect(
      sidebarWidthForKey({
        key: 'ArrowLeft',
        isShift: true,
        side: 'right',
        current: 890,
        available: 4000,
      }),
    ).toBe(900);
  });
});
