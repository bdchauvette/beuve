import type { TraceEntryView, TraceResultView } from '#contract/ipc-contract.ts';

/**
 * A probe result for `clamp` in `src/math.ts` (lines 1–9) with two tests: one passing whose eight
 * steps include two inside the hunk (lines 5 and 6), one failing that never reached the code.
 */
export function createTraceResultView(): TraceResultView {
  return {
    path: 'src/math.ts',
    headSha: 'c'.repeat(40),
    testFiles: ['src/math.test.ts'],
    functions: [{ index: 0, name: 'clamp', startLine: 1, endLine: 9 }],
    timelines: [
      {
        file: 'src/math.test.ts',
        titles: ['clamp', 'caps high values'],
        status: 'passed',
        durationMs: 3.4,
        entries: createEntries(),
        dropped: 0,
      },
      {
        file: 'src/math.test.ts',
        titles: ['clamp', 'never reaches it'],
        status: 'failed',
        failure: 'AssertionError: expected 1 to be 2\n    at foo',
        durationMs: 1200,
        entries: [],
        dropped: 4,
      },
    ],
    durationMs: 712,
  };
}

function createEntries(): TraceEntryView[] {
  return [
    {
      ...base(1, 1),
      kind: 'enter',
      label: 'clamp',
      args: [
        { name: 'value', value: summary('12') },
        { name: 'high', value: summary('10') },
      ],
    },
    { ...base(2, 2), kind: 'branch', construct: 'if', label: 'value < low', taken: false },
    {
      ...base(3, 5, 0, true),
      kind: 'branch',
      construct: 'if',
      label: 'value > high',
      taken: true,
    },
    { ...base(4, 6, 1, true), kind: 'loop', label: 'for (const x of xs)', iterations: 3 },
    {
      ...base(5, 7, 1),
      kind: 'branch',
      construct: 'switch',
      label: 'kind',
      value: summary('"a"'),
    },
    { ...base(6, 8, 1), kind: 'branch', construct: 'case', label: 'case "a"' },
    { ...base(7, 9), kind: 'return', value: summary('10'), implicit: false },
    { ...base(8, 9), kind: 'throw', value: summary('Error: no'), propagated: true },
  ];
}

function summary(preview: string): { type: string; preview: string } {
  return { type: 'number', preview };
}

function base(
  seq: number,
  line: number,
  depth = 0,
  isInHunk = false,
): Pick<TraceEntryView, 'seq' | 'fn' | 'line' | 'depth' | 'inHunk' | 'label'> {
  return { seq, fn: 0, line, depth, inHunk: isInHunk, label: '' };
}
