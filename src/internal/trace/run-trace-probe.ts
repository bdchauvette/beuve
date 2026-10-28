import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { applyEdits } from './apply-edits.ts';
import { buildTraceTimelines } from './build-trace-timelines.ts';
import type { InstrumentationPlan } from './instrumentation-plan.ts';
import type { TraceError } from './trace-error.ts';
import type { TraceRunner, TraceRunRequest } from './trace-runner.ts';
import type { TraceResult } from './trace-timeline.ts';

export interface TraceProbeRequest extends Omit<TraceRunRequest, 'files'> {
  readonly plan: InstrumentationPlan;
  /** The head text the plan was made from; the plan's path must hold exactly this text. */
  readonly source: string;
}

/**
 * Instruments the plan's file in memory, runs the selected tests through `runner` and reduces what
 * the recorder saw into one timeline per test (ADR 0036).
 */
export async function runTraceProbe(
  request: TraceProbeRequest,
  runner: TraceRunner,
): Promise<Result<TraceResult, TraceError>> {
  const { plan, source, ...run } = request;
  const code = applyEdits(source, plan.edits);
  const output = await runner.run({
    ...run,
    files: [{ path: plan.path, original: source, code }],
  });
  if (!output.ok) {
    return output;
  }
  return ok({
    path: plan.path,
    functions: plan.functions,
    timelines: buildTraceTimelines(plan, output.value.records, output.value.outcomes),
    durationMs: output.value.durationMs,
  });
}
