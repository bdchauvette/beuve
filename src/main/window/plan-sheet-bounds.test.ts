import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { planSheetBounds } from './plan-sheet-bounds.ts';

describe('planSheetBounds', () => {
  test('centres the first sheet and steps the next ones down and right', ({ expect }) => {
    expect(
      planSheetBounds({ workArea: workArea(), remembered: undefined, openCount: 0 }),
    ).toStrictEqual({
      x: 340,
      y: 33,
      width: 760,
      height: 860,
    });
    expect(
      planSheetBounds({ workArea: workArea(), remembered: undefined, openCount: 2 }),
    ).toMatchObject({
      x: 396,
      y: 40,
    });
    expect(
      planSheetBounds({ workArea: workArea(), remembered: undefined, openCount: 8 }),
    ).toMatchObject({
      x: 340,
    });
  });

  test('reopens at the remembered place and size, kept on the work area', ({ expect }) => {
    const remembered = { x: 1300, y: 600, width: 500, height: 400 };
    expect(planSheetBounds({ workArea: workArea(), remembered, openCount: 0 })).toStrictEqual({
      x: 940,
      y: 500,
      width: 500,
      height: 400,
    });
    expect(
      planSheetBounds({
        workArea: { x: 0, y: 0, width: 300, height: 200 },
        remembered: { x: 0, y: 0, width: 100, height: 100 },
        openCount: 1,
      }),
    ).toStrictEqual({ x: 0, y: 0, width: 420, height: 320 });
  });
});

function workArea(): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 25, width: 1440, height: 875 };
}
