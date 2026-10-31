import type { TraceEntryView, TraceResultView, TraceValueView } from '#contract/ipc-contract.ts';

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
        duration: 'PT0.0034S',
        entries: createEntries(),
        dropped: 0,
      },
      {
        file: 'src/math.test.ts',
        titles: ['clamp', 'never reaches it'],
        status: 'failed',
        failure: 'AssertionError: expected 1 to be 2\n    at foo',
        duration: 'PT1.2S',
        entries: [],
        dropped: 4,
      },
    ],
    duration: 'PT0.712S',
  };
}

function createEntries(): TraceEntryView[] {
  return [
    {
      ...base({ seq: 1, line: 1 }),
      kind: 'enter',
      label: 'clamp',
      args: [
        { name: 'value', value: summary('12') },
        { name: 'high', value: summary('10') },
      ],
    },
    {
      ...base({ seq: 2, line: 2 }),
      kind: 'branch',
      construct: 'if',
      label: 'value < low',
      taken: false,
    },
    {
      ...base({ seq: 3, line: 5, inHunk: true }),
      kind: 'branch',
      construct: 'if',
      label: 'value > high',
      taken: true,
    },
    {
      ...base({ seq: 4, line: 6, depth: 1, inHunk: true }),
      kind: 'loop',
      label: 'for (const x of xs)',
      iterations: 3,
    },
    {
      ...base({ seq: 5, line: 7, depth: 1 }),
      kind: 'branch',
      construct: 'switch',
      label: 'kind',
      value: summary('"a"'),
    },
    {
      ...base({ seq: 6, line: 8, depth: 1 }),
      kind: 'branch',
      construct: 'case',
      label: 'case "a"',
    },
    { ...base({ seq: 7, line: 9 }), kind: 'return', value: summary('10'), implicit: false },
    { ...base({ seq: 8, line: 9 }), kind: 'throw', value: summary('Error: no'), propagated: true },
  ];
}

function summary(preview: string): TraceValueView {
  return { type: 'number', preview };
}

/** Where an entry sits: its order, line and call depth, and whether the hunk holds it. */
interface EntryPlace {
  readonly seq: number;
  readonly line: number;
  readonly depth?: number;
  readonly inHunk?: boolean;
}

/** The fields every entry kind shares. */
type EntryBase = Pick<TraceEntryView, 'seq' | 'fn' | 'line' | 'depth' | 'inHunk' | 'label'>;

function base({ seq, line, depth = 0, inHunk = false }: EntryPlace): EntryBase {
  return { seq, fn: 0, line, depth, inHunk, label: '' };
}
