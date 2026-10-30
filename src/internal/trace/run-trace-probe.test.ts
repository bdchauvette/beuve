import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { InstrumentationPlan } from './instrumentation-plan.ts';
import { runTraceProbe } from './run-trace-probe.ts';
import type { TraceProbeRequest } from './run-trace-probe.ts';
import type { TraceRunner, TraceRunRequest } from './trace-runner.ts';

function plan(): InstrumentationPlan {
  return {
    path: 'src/a.ts',
    functions: [{ index: 0, name: 'a', startLine: 1, endLine: 1 }],
    probes: [{ id: 0, kind: 'enter', fn: 0, line: 1, label: 'a', inHunk: true, parameters: [] }],
    edits: [{ offset: 0, text: '/*traced*/', side: 'open', span: 0, order: 0 }],
  };
}

function base(): Omit<TraceProbeRequest, 'plan' | 'source'> {
  return {
    trusted: true as const,
    worktree: '/w',
    dependencyRoot: '/r',
    testFiles: ['src/a.test.ts'],
    timeout: Temporal.Duration.from({ milliseconds: 1000 }),
  };
}

describe('runTraceProbe', () => {
  test('hands the runner the instrumented file and reduces its output', async ({ expect }) => {
    const seen: TraceRunRequest[] = [];
    const runner: TraceRunner = {
      run: async (request) => {
        seen.push(request);
        await Promise.resolve();
        return ok({
          duration: Temporal.Duration.from({ milliseconds: 5 }),
          outcomes: [
            {
              file: 'src/a.test.ts',
              titles: ['t'],
              status: 'passed',
              duration: Temporal.Duration.from({ milliseconds: 1 }),
              failure: undefined,
            },
          ],
          records: [
            {
              test: { file: 'src/a.test.ts', titles: ['t'] },
              dropped: 0,
              events: [{ kind: 'enter', seq: 1, frame: 1, parent: undefined, probe: 0, args: [] }],
            },
          ],
        });
      },
    };
    const result = await runTraceProbe(
      { ...base(), plan: plan(), source: 'function a() {}' },
      runner,
    );
    expect(seen[0]?.files).toStrictEqual([
      { path: 'src/a.ts', original: 'function a() {}', code: '/*traced*/function a() {}' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        path: 'src/a.ts',
        duration: Temporal.Duration.from({ milliseconds: 5 }),
        timelines: [
          { titles: ['t'], status: 'passed', entries: [{ kind: 'enter', fn: 0, line: 1 }] },
        ],
      },
    });
  });

  test('passes runner failures through', async ({ expect }) => {
    const runner: TraceRunner = {
      run: async () => {
        await Promise.resolve();
        return err({ kind: 'cancelled' });
      },
    };
    await expect(
      runTraceProbe({ ...base(), plan: plan(), source: '' }, runner),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});
