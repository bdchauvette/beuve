import { describe, expect, it } from 'vitest';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import { toInsightAnnotations } from './to-insight-annotations.ts';

const hunks: DiffHunkView[] = [
  { oldStart: 1, oldCount: 3, newStart: 1, newCount: 4, header: '@@ -1,3 +1,4 @@' },
  { oldStart: 20, oldCount: 5, newStart: 21, newCount: 3, header: '@@ -20,5 +21,3 @@' },
  { oldStart: 40, oldCount: 2, newStart: 39, newCount: 0, header: '@@ -40,2 +38,0 @@' },
];

describe('toInsightAnnotations', () => {
  it('annotates after the last shown head line of each range', () => {
    const insights = [
      { id: 'a', lineStart: 2, lineEnd: 2 },
      { id: 'b', lineStart: 3, lineEnd: 30 },
      { id: 'c', lineStart: 15, lineEnd: 22 },
      { id: 'd', lineStart: 1, lineEnd: 23 },
    ];
    expect(
      toInsightAnnotations(hunks, insights).map(({ side, lineNumber, metadata }) => [
        side,
        lineNumber,
        metadata.id,
      ]),
    ).toEqual([
      ['additions', 2, 'a'],
      ['additions', 23, 'b'],
      ['additions', 22, 'c'],
      ['additions', 23, 'd'],
    ]);
  });

  it('makes ranges no hunk shows file-level annotations', () => {
    const annotations = toInsightAnnotations(hunks, [
      { lineStart: 10, lineEnd: 12 },
      { lineStart: 38, lineEnd: 39 },
    ]);
    expect(annotations.map(({ lineNumber }) => lineNumber)).toEqual([0, 0]);
  });
});
