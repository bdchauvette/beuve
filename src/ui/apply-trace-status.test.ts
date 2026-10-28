import { describe, expect, it } from 'vitest';

import type { TraceResultView, TraceStatusView } from '#contract/ipc-contract.ts';

import { applyTraceStatus } from './apply-trace-status.ts';
import type { TraceState } from './trace-state.ts';

const result: TraceResultView = {
  path: 'src/a.ts',
  headSha: 'c'.repeat(40),
  testFiles: ['src/a.test.ts'],
  functions: [],
  timelines: [],
  durationMs: 12,
};
const echo = { sessionId: 's1', runId: 'r1', path: 'src/a.ts', line: 5 };
const loading: TraceState = { path: 'src/a.ts', line: 5, status: 'loading', testFiles: undefined };

describe('applyTraceStatus', () => {
  it('shows the selected test files while running and the trace when completed', () => {
    const running: TraceStatusView = { ...echo, state: 'running', testFiles: ['src/a.test.ts'] };
    expect(applyTraceStatus(loading, 's1', running)).toEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'loading',
      testFiles: ['src/a.test.ts'],
    });
    expect(applyTraceStatus(loading, 's1', { ...echo, state: 'completed', result })).toEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'ready',
      result,
      note: undefined,
    });
  });

  it('asks for trust when the repository is untrusted', () => {
    const event: TraceStatusView = {
      ...echo,
      state: 'failed',
      failure: 'untrusted',
      message: 'no',
      repositoryPath: '/work/repo',
    };
    expect(applyTraceStatus(loading, 's1', event)).toEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'needs-trust',
      repositoryPath: '/work/repo',
    });
  });

  it('keeps the trace of a failed test and explains other failures', () => {
    const withTrace: TraceStatusView = {
      ...echo,
      state: 'failed',
      failure: 'test-failed-with-trace',
      message: 'Some of the tests failed.',
      result,
    };
    expect(applyTraceStatus(loading, 's1', withTrace)).toMatchObject({
      status: 'ready',
      note: 'Some of the tests failed.',
    });
    expect(
      applyTraceStatus(loading, 's1', {
        ...echo,
        state: 'failed',
        failure: 'timeout',
        message: 'Too slow.',
      }),
    ).toEqual({
      path: 'src/a.ts',
      line: 5,
      status: 'error',
      failure: 'timeout',
      message: 'Too slow.',
    });
  });

  it('ignores events for another session, file, line or no portal', () => {
    const event: TraceStatusView = { ...echo, state: 'completed', result };
    expect(applyTraceStatus(loading, 's2', event)).toBe(loading);
    expect(applyTraceStatus(loading, 's1', { ...event, path: 'src/b.ts' })).toBe(loading);
    expect(applyTraceStatus(loading, 's1', { ...event, line: 6 })).toBe(loading);
    expect(applyTraceStatus(undefined, 's1', event)).toBeUndefined();
  });
});
