import { describe } from 'vitest';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import { placeNoteOnDiff } from './place-note-on-diff.ts';
import type { HeadSideRange, NotePlacement } from './place-note-on-diff.ts';
import { test } from './testing/test.ts';

/** Head lines 10–14, 41–43 and a pure deletion after line 60. */
function hunks(): DiffHunkView[] {
  return [
    { oldStart: 10, oldCount: 4, newStart: 10, newCount: 5, header: '@@ -10,4 +10,5 @@' },
    { oldStart: 40, oldCount: 3, newStart: 41, newCount: 3, header: '@@ -40,3 +41,3 @@' },
    { oldStart: 60, oldCount: 2, newStart: 60, newCount: 0, header: '@@ -60,2 +60,0 @@' },
  ];
}

interface Case {
  readonly name: string;
  readonly range: HeadSideRange;
  readonly placement: NotePlacement;
}

describe('placeNoteOnDiff', () => {
  test.for<Case>([
    {
      name: 'a line inside a hunk sits under it',
      range: { lineStart: 11, lineEnd: 12 },
      placement: { kind: 'shown', after: 12 },
    },
    {
      name: 'a range that leaves a hunk sits under its last shown line',
      range: { lineStart: 13, lineEnd: 30 },
      placement: { kind: 'shown', after: 14 },
    },
    {
      name: 'a whole-file note sits above the first hunk',
      range: { lineStart: 0, lineEnd: 0 },
      placement: { kind: 'shown', after: 0 },
    },
    {
      name: 'a line just above the first hunk reveals from that hunk',
      range: { lineStart: 7, lineEnd: 7 },
      placement: { kind: 'hidden', after: 0, expansion: { gap: 0, direction: 'down', lines: 3 } },
    },
    {
      name: 'a line near the top of the file reveals from line 1',
      range: { lineStart: 2, lineEnd: 2 },
      placement: { kind: 'hidden', after: 0, expansion: { gap: 0, direction: 'up', lines: 2 } },
    },
    {
      name: 'a line just after a hunk reveals from that hunk',
      range: { lineStart: 17, lineEnd: 18 },
      placement: { kind: 'hidden', after: 14, expansion: { gap: 1, direction: 'up', lines: 4 } },
    },
    {
      name: 'a line just before the next hunk reveals from the next hunk',
      range: { lineStart: 36, lineEnd: 38 },
      placement: { kind: 'hidden', after: 14, expansion: { gap: 1, direction: 'down', lines: 5 } },
    },
    {
      name: 'a line before a pure deletion is in the gap that ends at it',
      range: { lineStart: 59, lineEnd: 59 },
      placement: { kind: 'hidden', after: 43, expansion: { gap: 2, direction: 'down', lines: 2 } },
    },
    {
      name: 'a line after the last hunk reveals the trailing context',
      range: { lineStart: 70, lineEnd: 72 },
      placement: { kind: 'hidden', after: 60, expansion: { gap: 3, direction: 'up', lines: 12 } },
    },
  ])('$name', ({ range, placement }, { expect }) => {
    expect(placeNoteOnDiff({ hunks: hunks(), revealed: [] }, range)).toStrictEqual(placement);
  });

  test('a revealed range is shown at its own lines', ({ expect }) => {
    const shown = { hunks: hunks(), revealed: [{ lineStart: 15, lineEnd: 18 }] };
    expect(placeNoteOnDiff(shown, { lineStart: 17, lineEnd: 18 })).toStrictEqual({
      kind: 'shown',
      after: 18,
    });
    expect(placeNoteOnDiff(shown, { lineStart: 30, lineEnd: 30 })).toStrictEqual({
      kind: 'hidden',
      after: 14,
      expansion: { gap: 1, direction: 'down', lines: 11 },
    });
  });
});
