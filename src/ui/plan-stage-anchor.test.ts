import { describe, expect, it } from 'vitest';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import { planStageAnchor } from './plan-stage-anchor.ts';

function hunk(newStart: number, newCount: number): DiffHunkView {
  return { oldStart: newStart, oldCount: 3, newStart, newCount, header: '@@' };
}

describe('planStageAnchor', () => {
  it('prefers a head-side line selection, in either drag direction', () => {
    expect(planStageAnchor('a.ts', hunk(10, 5), { start: 14, end: 12, side: 'additions' })).toEqual(
      { kind: 'lines', path: 'a.ts', startLine: 12, endLine: 14 },
    );
    expect(planStageAnchor('a.ts', undefined, { start: 3, end: 3 })).toEqual({
      kind: 'lines',
      path: 'a.ts',
      startLine: 3,
      endLine: 3,
    });
  });

  it('falls back to the focused hunk for base-side or mixed selections', () => {
    expect(planStageAnchor('a.ts', hunk(10, 5), { start: 11, end: 11, side: 'deletions' })).toEqual(
      { kind: 'lines', path: 'a.ts', startLine: 10, endLine: 14 },
    );
    expect(
      planStageAnchor('a.ts', hunk(10, 5), {
        start: 11,
        end: 12,
        side: 'additions',
        endSide: 'deletions',
      }),
    ).toMatchObject({ startLine: 10, endLine: 14 });
  });

  it('anchors a pure deletion to the head line it follows, and no hunk to the file', () => {
    expect(planStageAnchor('a.ts', hunk(7, 0), undefined)).toEqual({
      kind: 'lines',
      path: 'a.ts',
      startLine: 7,
      endLine: 7,
    });
    expect(planStageAnchor('a.ts', hunk(0, 0), undefined)).toMatchObject({ startLine: 1 });
    expect(planStageAnchor('a.ts', undefined, undefined)).toEqual({ kind: 'file', path: 'a.ts' });
  });
});
