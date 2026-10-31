import { describe } from 'vitest';

import type { DiffHunkView } from '#contract/ipc-contract.ts';

import type { HunkSpan } from './first-hunk-line.ts';
import { mergeReviewInsights } from './merge-review-insights.ts';
import { planInsightMarks } from './plan-insight-marks.ts';
import { createFindingView } from './testing/create-finding-view.ts';
import { createReviewMessageView } from './testing/create-review-message-view.ts';
import { test } from './testing/test.ts';

/** A hunk with the same span on both sides. */
function hunk(span: HunkSpan): DiffHunkView {
  return {
    oldStart: span.start,
    oldCount: span.count,
    newStart: span.start,
    newCount: span.count,
    header: '',
  };
}

function insightsOf(
  ...findings: Parameters<typeof createFindingView>[0][]
): ReturnType<typeof mergeReviewInsights> {
  return mergeReviewInsights(
    [createReviewMessageView(findings.map((finding) => createFindingView(finding)))],
    'a'.repeat(40),
  );
}

describe('planInsightMarks', () => {
  test('marks the first shown line of each range, sorted by line', ({ expect }) => {
    const marks = planInsightMarks(
      [hunk({ start: 1, count: 10 }), hunk({ start: 40, count: 5 })],
      insightsOf(
        { startLine: 42, endLine: 44, severity: 'info', category: 'other' },
        { startLine: 3, endLine: 5, severity: 'warning', category: 'edge-case' },
      ),
    );
    expect(marks).toStrictEqual([
      { line: 3, severity: 'warning' },
      { line: 42, severity: 'info' },
    ]);
  });

  test('starts at the hunk when the range begins above what the patch shows', ({ expect }) => {
    const marks = planInsightMarks(
      [hunk({ start: 10, count: 5 })],
      insightsOf({ startLine: 8, endLine: 11 }),
    );
    expect(marks).toStrictEqual([{ line: 10, severity: 'warning' }]);
  });

  test('lets the most severe insight on a line win', ({ expect }) => {
    const marks = planInsightMarks(
      [hunk({ start: 1, count: 10 })],
      insightsOf(
        { startLine: 4, endLine: 4, severity: 'info', category: 'other' },
        { startLine: 4, endLine: 6, severity: 'risk', category: 'security' },
        { startLine: 4, endLine: 4, severity: 'warning', category: 'complexity' },
      ),
    );
    expect(marks).toStrictEqual([{ line: 4, severity: 'risk' }]);
  });

  test('gives no mark to ranges no hunk shows', ({ expect }) => {
    expect(
      planInsightMarks(
        [hunk({ start: 1, count: 3 }), hunk({ start: 9, count: 0 })],
        insightsOf({ startLine: 20, endLine: 21 }),
      ),
    ).toStrictEqual([]);
    expect(planInsightMarks([], insightsOf({ startLine: 1, endLine: 1 }))).toStrictEqual([]);
  });
});
