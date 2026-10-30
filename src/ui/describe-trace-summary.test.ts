import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeTraceSummary } from './describe-trace-summary.ts';
import { planTraceTimeline } from './plan-trace-timeline.ts';
import { createTraceResultView } from './testing/create-trace-result-view.ts';

describe('describeTraceSummary', () => {
  test('says what was traced, how many tests reached it and how they went', ({ expect }) => {
    const view = createTraceResultView();
    expect(describeTraceSummary(view, planTraceTimeline(view))).toBe(
      'Traced clamp · 2 tests, 1 reached it · 1 failed · 712 ms',
    );
    expect(describeTraceSummary({ ...view, functions: [], timelines: [] }, [])).toBe(
      'No function traced · 0 tests, 0 reached it · 712 ms',
    );
  });
});
