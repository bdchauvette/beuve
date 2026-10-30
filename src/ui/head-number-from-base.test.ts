import { describe } from 'vitest';

import { headNumberFromBase } from './head-number-from-base.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

describe('headNumberFromBase', () => {
  test('maps unchanged lines inside hunks to their head numbers', ({ expect }) => {
    const file = createTwoHunkFileView();
    expect(headNumberFromBase(file, 1)).toBe(1);
    expect(headNumberFromBase(file, 3)).toBe(4);
    expect(headNumberFromBase(file, 10)).toBe(11);
    expect(headNumberFromBase(file, 12)).toBe(12);
  });

  test('maps lines between and after hunks by the offset before them', ({ expect }) => {
    const file = createTwoHunkFileView();
    expect(headNumberFromBase(file, 7)).toBe(8);
    expect(headNumberFromBase(file, 40)).toBe(40);
  });

  test('maps a deleted line to the head line before the gap', ({ expect }) => {
    const file = createTwoHunkFileView();
    expect(headNumberFromBase(file, 2)).toBe(1);
    expect(headNumberFromBase(file, 11)).toBe(11);
    expect(headNumberFromBase(createDiffFileView('a.ts', ['-gone', ' kept']), 1)).toBe(1);
  });

  test('places lines around a pure addition, whose base start is the line before it', ({
    expect,
  }) => {
    const file = createDiffFileView('a.ts', [], 1, {
      hunks: [{ oldStart: 5, oldCount: 0, newStart: 6, newCount: 2, header: '@@ -5,0 +6,2 @@' }],
      patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -5,0 +6,2 @@\n+x\n+y\n',
    });
    expect(headNumberFromBase(file, 5)).toBe(5);
    expect(headNumberFromBase(file, 6)).toBe(8);
  });

  test('has no head line on a deleted file', ({ expect }) => {
    expect(headNumberFromBase(createTwoHunkFileView({ status: 'deleted' }), 2)).toBeUndefined();
  });
});
