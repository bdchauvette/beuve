import type { TraceResultView, TraceTimelineView } from '#contract/ipc-contract.ts';
import type { TraceResult, TraceTimeline } from '#internal/trace/trace-timeline.ts';

export interface TraceResultContext {
  readonly headSha: string;
  readonly testFiles: readonly string[];
}

/** The probe's result as contract data; entries are plain data already and pass through. */
export function toTraceResultView(
  result: TraceResult,
  context: TraceResultContext,
): TraceResultView {
  return {
    path: result.path,
    headSha: context.headSha,
    testFiles: context.testFiles,
    functions: result.functions.map((fn) => ({ ...fn })),
    timelines: result.timelines.map((timeline) => toTimelineView(timeline)),
    durationMs: result.durationMs,
  };
}

function toTimelineView(timeline: TraceTimeline): TraceTimelineView {
  return {
    file: timeline.file,
    titles: timeline.titles,
    status: timeline.status,
    ...(timeline.failure !== undefined && { failure: timeline.failure }),
    ...(timeline.durationMs !== undefined && { durationMs: timeline.durationMs }),
    entries: timeline.entries,
    dropped: timeline.dropped,
  };
}
