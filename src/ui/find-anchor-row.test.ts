import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { findAnchorRow } from './find-anchor-row.ts';
import { planTraceTimeline } from './plan-trace-timeline.ts';
import { createTraceResultView } from './testing/create-trace-result-view.ts';
import { definedValue } from './testing/defined-value.ts';

describe('findAnchorRow', () => {
  test('lands on the first row in the hunk', ({ expect }) => {
    const cases = planTraceTimeline(createTraceResultView());
    expect(findAnchorRow(cases)).toStrictEqual({ caseIndex: 0, rowIndex: 2 });
  });

  test('falls back to the first row of the first case that has rows', ({ expect }) => {
    const view = createTraceResultView();
    const passed = definedValue(view.timelines[0]);
    const failed = definedValue(view.timelines[1]);
    const outsideHunk = passed.entries.filter((entry) => !entry.inHunk);
    const cases = planTraceTimeline({
      ...view,
      timelines: [failed, { ...passed, entries: outsideHunk }],
    });
    expect(findAnchorRow(cases)).toStrictEqual({ caseIndex: 1, rowIndex: 0 });
  });

  test('finds nothing without rows', ({ expect }) => {
    expect(findAnchorRow([])).toBeUndefined();
  });
});
