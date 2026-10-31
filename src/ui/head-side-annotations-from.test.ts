import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import { headSideAnnotationsFrom } from './head-side-annotations-from.ts';

function hunks(): DiffHunkView[] {
  return [
    { oldStart: 1, oldCount: 3, newStart: 1, newCount: 4, header: '@@ -1,3 +1,4 @@' },
    { oldStart: 20, oldCount: 5, newStart: 21, newCount: 3, header: '@@ -20,5 +21,3 @@' },
    { oldStart: 40, oldCount: 2, newStart: 38, newCount: 0, header: '@@ -40,2 +38,0 @@' },
  ];
}

describe('headSideAnnotationsFrom', () => {
  test('annotates after the last shown head line of each range', ({ expect }) => {
    const notes = [
      { id: 'a', lineStart: 2, lineEnd: 2 },
      { id: 'b', lineStart: 3, lineEnd: 30 },
      { id: 'c', lineStart: 15, lineEnd: 22 },
      { id: 'd', lineStart: 1, lineEnd: 23 },
    ];
    expect(
      headSideAnnotationsFrom({ hunks: hunks(), revealed: [] }, notes).map(
        ({ side, lineNumber, metadata }) => {
          return [side, lineNumber, metadata.note.id, metadata.placement.kind];
        },
      ),
    ).toStrictEqual([
      ['additions', 2, 'a', 'shown'],
      ['additions', 23, 'b', 'shown'],
      ['additions', 22, 'c', 'shown'],
      ['additions', 23, 'd', 'shown'],
    ]);
  });

  test('puts ranges no hunk shows above the gap that holds them', ({ expect }) => {
    const annotations = headSideAnnotationsFrom({ hunks: hunks(), revealed: [] }, [
      { lineStart: 10, lineEnd: 12 },
      { lineStart: 38, lineEnd: 38 },
      { lineStart: 0, lineEnd: 0 },
    ]);
    expect(
      annotations.map(({ lineNumber, metadata }) => {
        return [lineNumber, metadata.placement.kind];
      }),
    ).toStrictEqual([
      [4, 'hidden'],
      [23, 'hidden'],
      [0, 'shown'],
    ]);
  });

  test('annotates a revealed range at its own line', ({ expect }) => {
    const [annotation] = headSideAnnotationsFrom(
      { hunks: hunks(), revealed: [{ lineStart: 10, lineEnd: 12 }] },
      [{ lineStart: 10, lineEnd: 12 }],
    );
    expect(annotation?.lineNumber).toBe(12);
  });
});
