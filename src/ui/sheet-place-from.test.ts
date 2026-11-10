import { describe } from 'vitest';

import { sheetPlaceFrom } from './sheet-place-from.ts';
import type { SheetPlace } from './step-sheet-history.ts';
import { targetFrom } from './target-from.ts';
import type { TargetState } from './target-from.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

function placeOf(overrides: Partial<TargetState>): SheetPlace | undefined {
  return sheetPlaceFrom(
    targetFrom({
      file: createTwoHunkFileView(),
      hunk: -1,
      selection: undefined,
      line: undefined,
      collapsed: false,
      ...overrides,
    }),
  );
}

function lines(start: number, end: number): SheetPlace {
  return {
    path: 'src/a.ts',
    range: { startLine: start, startCharacter: 0, endLine: end, endCharacter: 0 },
  };
}

describe('sheetPlaceFrom', () => {
  test('opens on the head lines the target points at', ({ expect }) => {
    expect(placeOf({ selection: { start: 5, end: 3 } })).toStrictEqual(lines(3, 5));
    expect(placeOf({ hunk: 0 })).toStrictEqual(lines(1, 5));
    expect(placeOf({ hunk: 1 })).toStrictEqual(lines(11, 12));
    expect(placeOf({ line: 9 })).toStrictEqual(lines(9, 9));
    expect(placeOf({})).toStrictEqual(lines(1, 1));
  });

  test('opens a file without head changes at its top', ({ expect }) => {
    const file = createTwoHunkFileView({ patch: '', hunks: [] });
    expect(placeOf({ file })).toStrictEqual({ path: 'src/a.ts', range: undefined });
  });

  test('has nothing to open without a file, or for a deleted one', ({ expect }) => {
    expect(placeOf({ file: undefined })).toBeUndefined();
    expect(placeOf({ file: createTwoHunkFileView({ status: 'deleted' }) })).toBeUndefined();
  });
});
