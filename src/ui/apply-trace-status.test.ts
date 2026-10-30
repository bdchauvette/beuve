import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { TraceResultView, TraceStatusView } from '#contract/ipc-contract.ts';

import { applyTraceStatus } from './apply-trace-status.ts';
import type { TraceState } from './trace-state.ts';

function result(): TraceResultView {
  return {
    path: 'src/a.ts',
    headSha: 'c'.repeat(40),
    testFiles: ['src/a.test.ts'],
    functions: [],
    timelines: [],
    duration: 'PT0.012S',
  };
}
function echo(): { sessionId: string; runId: string; path: string; line: number } {
  return { sessionId: 's1', runId: 'r1', path: 'src/a.ts', line: 5 };
}
function loading(): TraceState {
  return { path: 'src/a.ts', line: 5, status: 'loading', testFiles: undefined };
}

describe('applyTraceStatus', () => {
  test('shows the selected test files while running and the trace when completed', ({ expect }) => {
    const running: TraceStatusView = { ...echo(), state: 'running', testFiles: ['src/a.test.ts'] };
    expect(applyTraceStatus(loading(), 's1', running)).toStrictEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'loading',
      testFiles: ['src/a.test.ts'],
    });
    expect(
      applyTraceStatus(loading(), 's1', { ...echo(), state: 'completed', result: result() }),
    ).toStrictEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'ready',
      result: result(),
      note: undefined,
    });
  });

  test('asks for trust when the repository is untrusted', ({ expect }) => {
    const event: TraceStatusView = {
      ...echo(),
      state: 'failed',
      failure: 'untrusted',
      message: 'no',
      repositoryPath: '/work/repo',
    };
    expect(applyTraceStatus(loading(), 's1', event)).toStrictEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'needs-trust',
      repositoryPath: '/work/repo',
    });
  });

  test('keeps the trace of a failed test and explains other failures', ({ expect }) => {
    const withTrace: TraceStatusView = {
      ...echo(),
      state: 'failed',
      failure: 'test-failed-with-trace',
      message: 'Some of the tests failed.',
      result: result(),
    };
    expect(applyTraceStatus(loading(), 's1', withTrace)).toMatchObject({
      status: 'ready',
      note: 'Some of the tests failed.',
    });
    expect(
      applyTraceStatus(loading(), 's1', {
        ...echo(),
        state: 'failed',
        failure: 'timeout',
        message: 'Too slow.',
      }),
    ).toStrictEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'error',
      failure: 'timeout',
      message: 'Too slow.',
    });
  });

  test('ignores events for another session, file, line or no portal', ({ expect }) => {
    const event: TraceStatusView = { ...echo(), state: 'completed', result: result() };
    const state = loading();
    expect(applyTraceStatus(state, 's2', event)).toBe(state);
    expect(applyTraceStatus(state, 's1', { ...event, path: 'src/b.ts' })).toBe(state);
    expect(applyTraceStatus(state, 's1', { ...event, line: 6 })).toBe(state);
    expect(applyTraceStatus(undefined, 's1', event)).toBeUndefined();
  });
});
