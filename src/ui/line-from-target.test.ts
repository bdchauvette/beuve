import { describe } from 'vitest';

import { lineFromTarget } from './line-from-target.ts';
import { targetFrom } from './target-from.ts';
import type { TargetState } from './target-from.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

function lineOf(overrides: Partial<TargetState>): number | undefined {
  return lineFromTarget(
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

describe('lineFromTarget', () => {
  test('takes a selection’s first head line, mapped from the base side', ({ expect }) => {
    expect(lineOf({ selection: { start: 5, end: 3 } })).toBe(3);
    expect(lineOf({ selection: { start: 3, end: 4, side: 'deletions' } })).toBe(4);
    expect(lineOf({ selection: { start: 11, end: 11, side: 'deletions' } })).toBe(11);
  });

  test('takes the focused hunk’s first change, a jump’s line, or the file’s first change', ({
    expect,
  }) => {
    expect(lineOf({ hunk: 1 })).toBe(11);
    expect(lineOf({ line: 9 })).toBe(9);
    expect(lineOf({})).toBe(1);
  });

  test('has no line for a file without head changes, or the whole change', ({ expect }) => {
    expect(lineOf({ file: createTwoHunkFileView({ patch: '', hunks: [] }) })).toBeUndefined();
    expect(lineOf({ file: undefined })).toBeUndefined();
  });
});
