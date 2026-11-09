import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import type { ChangeRun } from './change-run.ts';
import { changeRunsFrom } from './change-runs-from.ts';

function patchOf(...lines: string[]): string {
  return ['diff --git a/a.md b/a.md', '--- a/a.md', '+++ b/a.md', ...lines, ''].join('\n');
}

describe('changeRunsFrom', () => {
  test.for<[string, string, ChangeRun[]]>([
    [
      'a replacement between context lines',
      patchOf('@@ -1,4 +1,4 @@', ' a', '-b', '-c', '+B', ' d'),
      [{ base: { start: 2, end: 3 }, head: { start: 2, end: 2 }, headAfter: 3, removes: true }],
    ],
    [
      'an addition, then a removal in a later hunk',
      patchOf('@@ -1,2 +1,3 @@', ' a', '+new', ' b', '@@ -10,3 +11,2 @@', ' j', '-k', ' l'),
      [
        { head: { start: 2, end: 2 }, headAfter: 3, removes: false },
        { base: { start: 11, end: 11 }, headAfter: 12, removes: true },
      ],
    ],
    [
      'a new file',
      patchOf('@@ -0,0 +1,2 @@', '+one', '+two'),
      [{ head: { start: 1, end: 2 }, headAfter: 3, removes: false }],
    ],
    [
      'a removal at the end of the file, with no newline marker',
      patchOf('@@ -2,2 +2,1 @@', ' b', '-c', '\\ No newline at end of file'),
      [{ base: { start: 3, end: 3 }, headAfter: 3, removes: true }],
    ],
  ])('%s', ([, patch, expected], { expect }) => {
    expect(changeRunsFrom(patch)).toStrictEqual(expected);
  });
});
