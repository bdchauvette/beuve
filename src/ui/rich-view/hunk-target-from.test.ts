import { describe } from 'vitest';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import { test } from '../testing/test.ts';

import { changeRunsFrom } from './change-runs-from.ts';
import { hunkTargetFrom } from './hunk-target-from.ts';

function patchOf(...lines: string[]): string {
  return ['diff --git a/a.md b/a.md', '--- a/a.md', '+++ b/a.md', ...lines, ''].join('\n');
}

function hunkOf(header: string): DiffHunkView {
  const [, oldStart = 0, oldCount = 1, newStart = 0, newCount = 1] = header
    .replaceAll(/[@+-]/gu, ' ')
    .split(/[\s,]+/u)
    .map(Number);
  return { oldStart, oldCount, newStart, newCount, header };
}

describe('hunkTargetFrom', () => {
  test('takes the head lines a hunk adds, not its context', ({ expect }) => {
    const header = '@@ -1,4 +1,5 @@';
    const runs = changeRunsFrom(patchOf(header, ' a', '-b', '+B', '+C', ' d', ' e'));
    expect(hunkTargetFrom(hunkOf(header), runs)).toStrictEqual({
      side: 'head',
      lines: { start: 2, end: 3 },
    });
  });

  test('takes the base lines of a hunk that only removes', ({ expect }) => {
    const header = '@@ -10,3 +10,2 @@';
    const runs = changeRunsFrom(patchOf(header, ' j', '-k', ' l'));
    expect(hunkTargetFrom(hunkOf(header), runs)).toStrictEqual({
      side: 'base',
      lines: { start: 11, end: 11 },
    });
  });
});
