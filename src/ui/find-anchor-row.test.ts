import { describe, expect, it } from 'vitest';

import { findAnchorRow } from './find-anchor-row.ts';
import { planTraceTimeline } from './plan-trace-timeline.ts';
import { createTraceResultView } from './testing/create-trace-result-view.ts';

describe('findAnchorRow', () => {
  it('lands on the first row in the hunk', () => {
    const cases = planTraceTimeline(createTraceResultView());
    expect(findAnchorRow(cases)).toEqual({ caseIndex: 0, rowIndex: 2 });
  });

  it('falls back to the first row of the first case that has rows', () => {
    const view = createTraceResultView();
    const [passed, failed] = view.timelines;
    if (passed === undefined || failed === undefined) {
      throw new Error('fixture changed');
    }
    const outsideHunk = passed.entries.filter((entry) => !entry.inHunk);
    const cases = planTraceTimeline({
      ...view,
      timelines: [failed, { ...passed, entries: outsideHunk }],
    });
    expect(findAnchorRow(cases)).toEqual({ caseIndex: 1, rowIndex: 0 });
  });

  it('finds nothing without rows', () => {
    expect(findAnchorRow([])).toBeUndefined();
  });
});
