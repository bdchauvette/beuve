import type { TracedFunction } from './instrumentation-plan.ts';
import type { TestStatus } from './trace-runner.ts';
import type { ValueSummary } from './value-summary.ts';

/** What every timeline entry carries. `line` is one-based in the head text, like the diff's. */
interface TraceEntryBase {
  readonly seq: number;
  /** Index into the result's `functions`. */
  readonly fn: number;
  readonly line: number;
  /** Call depth among traced functions, 0 for the outermost. */
  readonly depth: number;
  /** The construct's own lines are part of the hunk. */
  readonly inHunk: boolean;
  /** The probe's source snippet (condition, case, loop header, statement). */
  readonly label: string;
}

/** One step of an execution trace, in the order it happened. */
export type TraceEntry = TraceEntryBase &
  (
    | {
        readonly kind: 'enter';
        readonly args: readonly { readonly name: string; readonly value: ValueSummary }[];
      }
    | { readonly kind: 'branch'; readonly construct: 'if' | 'ternary'; readonly taken: boolean }
    | {
        readonly kind: 'branch';
        readonly construct: 'switch' | 'catch';
        readonly value: ValueSummary;
      }
    | { readonly kind: 'branch'; readonly construct: 'case' | 'default' }
    | { readonly kind: 'loop'; readonly iterations: number }
    | { readonly kind: 'return'; readonly value: ValueSummary; readonly implicit: boolean }
    | {
        readonly kind: 'throw';
        readonly value: ValueSummary;
        /** The exception came from a callee and passed through. */
        readonly propagated: boolean;
      }
  );

/** One test's trace. Events outside any test have an empty `file` and no titles. */
export interface TraceTimeline {
  readonly file: string;
  readonly titles: readonly string[];
  readonly status: TestStatus | 'unknown';
  readonly failure: string | undefined;
  readonly entries: readonly TraceEntry[];
  /** Events the recorder dropped at its limits. */
  readonly dropped: number;
}

/** A probe run's outcome: the traced functions and one timeline per test that ran. */
export interface TraceResult {
  readonly path: string;
  readonly functions: readonly TracedFunction[];
  readonly timelines: readonly TraceTimeline[];
  readonly durationMs: number;
}
