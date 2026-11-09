import { describe } from 'vitest';

import type { DiffHunkView, UraAnchorView } from '#contract/ipc-contract.ts';

import { isOutsideHunks } from './is-outside-hunks.ts';
import { test } from './testing/test.ts';

function hunksOf(): DiffHunkView[] {
  return [
    { oldStart: 5, oldCount: 4, newStart: 5, newCount: 6, header: '@@ -5,4 +5,6 @@' },
    { oldStart: 30, oldCount: 2, newStart: 32, newCount: 0, header: '@@ -30,2 +32,0 @@' },
  ];
}

function linesOf(start: number, end: number): UraAnchorView {
  return { kind: 'lines', path: 'README.md', startLine: start, endLine: end };
}

describe('isOutsideHunks', () => {
  test.for<[string, UraAnchorView, boolean]>([
    ['lines inside a hunk', linesOf(6, 7), false],
    ['lines overlapping a hunk', linesOf(1, 5), false],
    ['lines between hunks', linesOf(12, 20), true],
    ['lines at a pure deletion', linesOf(32, 33), true],
    ['a file anchor', { kind: 'file', path: 'README.md' }, false],
  ])('%s', ([, anchor, expected], { expect }) => {
    expect(isOutsideHunks(anchor, hunksOf())).toBe(expected);
  });
});
