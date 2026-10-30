import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { buildTraceTimelines } from './build-trace-timelines.ts';
import type { InstrumentationPlan } from './instrumentation-plan.ts';
import type { ValueSummary } from './value-summary.ts';
import type { TestOutcome } from './trace-runner.ts';

function plan(): InstrumentationPlan {
  return {
    path: 'src/a.ts',
    functions: [{ index: 0, name: 'a', startLine: 1, endLine: 5 }],
    probes: [
      { id: 0, kind: 'enter', fn: 0, line: 1, label: 'a', inHunk: false, parameters: ['x'] },
      { id: 1, kind: 'if', fn: 0, line: 2, label: 'x', inHunk: true },
    ],
    edits: [],
  };
}

function one(): ValueSummary {
  return { type: 'number', preview: '1' };
}

describe('buildTraceTimelines', () => {
  test('joins records to outcomes, orders by sequence and skips unknown probes', ({ expect }) => {
    const timelines = buildTraceTimelines(
      plan(),
      [
        {
          test: { file: 'src/a.test.ts', titles: ['one'] },
          dropped: 2,
          events: [
            { kind: 'return', seq: 4, frame: 1, probe: undefined, value: one() },
            { kind: 'branch', seq: 2, frame: 1, probe: 1, taken: false },
            { kind: 'branch', seq: 3, frame: 1, probe: 9, taken: true },
            { kind: 'mark', seq: 3, frame: 1, probe: 1 },
            { kind: 'enter', seq: 1, frame: 1, parent: 7, probe: 0, args: [one()] },
          ],
        },
        {
          test: undefined,
          dropped: 0,
          events: [{ kind: 'branch', seq: 1, frame: 3, probe: 1, taken: true }],
        },
      ],
      [outcome(['one'], 'passed'), outcome(['two'], 'failed'), outcome(['three'], 'skipped')],
    );
    expect(timelines).toStrictEqual([
      {
        file: 'src/a.test.ts',
        titles: ['one'],
        status: 'passed',
        failure: undefined,
        duration: Temporal.Duration.from({ milliseconds: 1 }),
        dropped: 2,
        entries: [
          {
            seq: 1,
            fn: 0,
            line: 1,
            depth: 0,
            inHunk: false,
            label: 'a',
            kind: 'enter',
            args: [{ name: 'x', value: one() }],
          },
          {
            seq: 2,
            fn: 0,
            line: 2,
            depth: 0,
            inHunk: true,
            label: 'x',
            kind: 'branch',
            construct: 'if',
            taken: false,
          },
          {
            seq: 4,
            fn: 0,
            line: 5,
            depth: 0,
            inHunk: false,
            label: 'a',
            kind: 'return',
            value: one(),
            implicit: true,
          },
        ],
      },
      {
        file: 'src/a.test.ts',
        titles: ['two'],
        status: 'failed',
        failure: undefined,
        duration: Temporal.Duration.from({ milliseconds: 1 }),
        dropped: 0,
        entries: [],
      },
      {
        file: '',
        titles: [],
        status: 'unknown',
        failure: undefined,
        duration: undefined,
        dropped: 0,
        entries: [
          {
            seq: 1,
            fn: 0,
            line: 2,
            depth: 0,
            inHunk: true,
            label: 'x',
            kind: 'branch',
            construct: 'if',
            taken: true,
          },
        ],
      },
    ]);
  });
});

function outcome(titles: string[], status: TestOutcome['status']): TestOutcome {
  return {
    file: 'src/a.test.ts',
    titles,
    status,
    duration: Temporal.Duration.from({ milliseconds: 1 }),
    failure: undefined,
  };
}
