import type { TraceRecorderLimits } from './create-trace-recorder.ts';

/** The recorder's default bounds (ADR 0036). */
export const defaultRecorderLimits: TraceRecorderLimits = {
  maxEvents: 2000,
  maxEventsPerProbe: 50,
  maxDepth: 2,
  maxItems: 5,
  maxStringLength: 60,
  maxPreviewLength: 160,
};
