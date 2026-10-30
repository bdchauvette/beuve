import vm from 'node:vm';

import { applyEdits } from '../apply-edits.ts';
import { buildTraceTimelines } from '../build-trace-timelines.ts';
import { createTraceRecorder } from '../create-trace-recorder.ts';
import { defaultRecorderLimits } from '../default-recorder-limits.ts';
import { ecmascriptTraceRules } from '../ecmascript-trace-rules.ts';
import type { InstrumentationPlan } from '../instrumentation-plan.ts';
import { planInstrumentation } from '../plan-instrumentation.ts';
import { traceGlobalName } from '../trace-global-name.ts';
import type { TraceTimeline } from '../trace-timeline.ts';
import { parseTestSource } from './parse-test-source.ts';

export interface TestTrace {
  readonly plan: InstrumentationPlan;
  readonly code: string;
  readonly timeline: TraceTimeline;
  /** What `run` evaluated to, or the error it threw. */
  readonly outcome: { readonly value: unknown } | { readonly error: unknown };
}

/**
 * Plans and instruments plain-JavaScript `source` (parsed with the TypeScript grammar), then
 * evaluates it followed by `run` in a fresh `vm` context with a recorder installed, the way the
 * Vitest setup module would. Test-only (ADR 0013).
 */
export async function traceTestSource(
  source: string,
  changedLines: readonly number[],
  run: string,
): Promise<TestTrace> {
  const root = await parseTestSource(source);
  const planned = planInstrumentation(
    root,
    { path: 'test.ts', changedLines: new Set(changedLines) },
    ecmascriptTraceRules,
  );
  if (!planned.ok) {
    throw new Error(`no plan: ${planned.error.kind}`);
  }
  const plan = planned.value;
  const code = applyEdits(source, plan.edits);
  const recorder = createTraceRecorder(defaultRecorderLimits);
  recorder.setTest({ file: 'test.ts', titles: ['case'] });
  const context = vm.createContext({ [traceGlobalName]: recorder });
  let outcome: TestTrace['outcome'];
  try {
    outcome = { value: vm.runInContext(`${code}\n;${run}`, context) as unknown };
  } catch (error: unknown) {
    outcome = { error };
  }
  const record = recorder.take();
  const timelines = buildTraceTimelines(plan, record === undefined ? [] : [record], [
    {
      file: 'test.ts',
      titles: ['case'],
      status: 'passed',
      duration: Temporal.Duration.from({ milliseconds: 1 }),
      failure: undefined,
    },
  ]);
  const timeline = timelines[0];
  if (timeline === undefined) {
    throw new Error('no timeline');
  }
  return { plan, code, timeline, outcome };
}
