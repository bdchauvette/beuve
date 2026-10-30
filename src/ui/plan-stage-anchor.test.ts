import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import { planStageAnchor } from './plan-stage-anchor.ts';

function hunk(newStart: number, newCount: number): DiffHunkView {
  return { oldStart: newStart, oldCount: 3, newStart, newCount, header: '@@' };
}

describe('planStageAnchor', () => {
  test('prefers a head-side line selection, in either drag direction', ({ expect }) => {
    expect(
      planStageAnchor('a.ts', hunk(10, 5), { start: 14, end: 12, side: 'additions' }),
    ).toStrictEqual({ kind: 'lines', path: 'a.ts', startLine: 12, endLine: 14 });
    expect(planStageAnchor('a.ts', undefined, { start: 3, end: 3 })).toStrictEqual({
      kind: 'lines',
      path: 'a.ts',
      startLine: 3,
      endLine: 3,
    });
  });

  test('falls back to the focused hunk for base-side or mixed selections', ({ expect }) => {
    expect(
      planStageAnchor('a.ts', hunk(10, 5), { start: 11, end: 11, side: 'deletions' }),
    ).toStrictEqual({ kind: 'lines', path: 'a.ts', startLine: 10, endLine: 14 });
    expect(
      planStageAnchor('a.ts', hunk(10, 5), {
        start: 11,
        end: 12,
        side: 'additions',
        endSide: 'deletions',
      }),
    ).toMatchObject({ startLine: 10, endLine: 14 });
  });

  test('anchors a pure deletion to the head line it follows, and no hunk to the file', ({
    expect,
  }) => {
    expect(planStageAnchor('a.ts', hunk(7, 0), undefined)).toStrictEqual({
      kind: 'lines',
      path: 'a.ts',
      startLine: 7,
      endLine: 7,
    });
    expect(planStageAnchor('a.ts', hunk(0, 0), undefined)).toMatchObject({ startLine: 1 });
    expect(planStageAnchor('a.ts', undefined, undefined)).toStrictEqual({
      kind: 'file',
      path: 'a.ts',
    });
  });
});
