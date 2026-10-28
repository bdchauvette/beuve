import { describe, expect, it } from 'vitest';

import { planTraceTimeline } from './plan-trace-timeline.ts';
import { createTraceResultView } from './testing/create-trace-result-view.ts';

describe('planTraceTimeline', () => {
  it('groups timelines per test case with status, duration and a one-line failure', () => {
    const cases = planTraceTimeline(createTraceResultView());
    expect(
      cases.map(({ title, status, duration, failure, dropped }) => ({
        title,
        status,
        duration,
        failure,
        dropped,
      })),
    ).toEqual([
      {
        title: 'clamp › caps high values',
        status: 'passed',
        duration: '3 ms',
        failure: '',
        dropped: 0,
      },
      {
        title: 'clamp › never reaches it',
        status: 'failed',
        duration: '1.2 s',
        failure: 'AssertionError: expected 1 to be 2',
        dropped: 4,
      },
    ]);
  });

  it('renders each step with its depth, line, hunk flag and outcome', () => {
    const [first] = planTraceTimeline(createTraceResultView());
    expect(
      first?.rows.map((row) => [
        row.depth,
        row.line,
        row.inHunk,
        row.tag,
        row.text,
        row.result,
        row.tone,
      ]),
    ).toEqual([
      [0, 1, false, 'call', 'clamp(value=12, high=10)', '', 'neutral'],
      [0, 2, false, 'if', 'value < low', 'false · else', 'skipped'],
      [0, 5, true, 'if', 'value > high', 'true · then', 'taken'],
      [1, 6, true, 'loop', 'for (const x of xs)', '3 iterations', 'neutral'],
      [1, 7, false, 'switch', 'kind', '= "a"', 'neutral'],
      [1, 8, false, 'case', 'case "a"', 'entered', 'taken'],
      [0, 9, false, 'return', '10', '', 'neutral'],
      [0, 9, false, 'throw', 'Error: no', 'passes through', 'danger'],
    ]);
    expect(first?.hunkRows).toBe(2);
  });

  it('names a test case outside any test and bounds long argument lists', () => {
    const view = createTraceResultView();
    const [entry] = view.timelines[0]?.entries ?? [];
    if (entry?.kind !== 'enter') {
      throw new Error('fixture changed');
    }
    const cases = planTraceTimeline({
      ...view,
      timelines: [
        {
          file: '',
          titles: [],
          status: 'unknown',
          entries: [
            {
              ...entry,
              args: [{ name: 'a', value: { type: 'string', preview: 'x'.repeat(200) } }],
            },
          ],
          dropped: 0,
        },
      ],
    });
    expect(cases[0]?.title).toBe('Outside any test');
    expect(cases[0]?.rows[0]?.text.length).toBeLessThan(160);
    expect(cases[0]?.rows[0]?.text.endsWith('…)')).toBe(true);
  });
});
