import { describe } from 'vitest';

import { nextRovingIndex } from './next-roving-index.ts';
import { test } from '../testing/test.ts';

describe('nextRovingIndex', () => {
  test('moves a menu with up and down, wrapping at the ends', ({ expect }) => {
    const menu = { count: 3, orientation: 'vertical' } as const;
    expect(nextRovingIndex({ ...menu, key: 'ArrowDown', index: 0 })).toBe(1);
    expect(nextRovingIndex({ ...menu, key: 'ArrowDown', index: 2 })).toBe(0);
    expect(nextRovingIndex({ ...menu, key: 'ArrowUp', index: 0 })).toBe(2);
    expect(nextRovingIndex({ ...menu, key: 'ArrowRight', index: 0 })).toBeUndefined();
  });

  test('goes to the first or last item with Home and End', ({ expect }) => {
    const menu = { count: 4, index: 1, orientation: 'vertical' } as const;
    expect(nextRovingIndex({ ...menu, key: 'Home' })).toBe(0);
    expect(nextRovingIndex({ ...menu, key: 'End' })).toBe(3);
  });

  test('starts at an end when nothing has focus yet', ({ expect }) => {
    const menu = { count: 3, index: -1, orientation: 'vertical' } as const;
    expect(nextRovingIndex({ ...menu, key: 'ArrowDown' })).toBe(0);
    expect(nextRovingIndex({ ...menu, key: 'ArrowUp' })).toBe(2);
  });

  test('moves a tab list with left and right, mirrored in right-to-left text', ({ expect }) => {
    const tabs = { count: 3, index: 1, orientation: 'horizontal' } as const;
    expect(nextRovingIndex({ ...tabs, key: 'ArrowRight' })).toBe(2);
    expect(nextRovingIndex({ ...tabs, key: 'ArrowLeft' })).toBe(0);
    expect(nextRovingIndex({ ...tabs, key: 'ArrowRight', direction: 'rtl' })).toBe(0);
    expect(nextRovingIndex({ ...tabs, key: 'ArrowDown' })).toBeUndefined();
  });

  test('does nothing for other keys or an empty list', ({ expect }) => {
    expect(
      nextRovingIndex({ key: 'a', index: 0, count: 3, orientation: 'vertical' }),
    ).toBeUndefined();
    expect(
      nextRovingIndex({ key: 'End', index: -1, count: 0, orientation: 'vertical' }),
    ).toBeUndefined();
  });
});
