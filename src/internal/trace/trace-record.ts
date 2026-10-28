import type { ValueSummary } from './value-summary.ts';

/** The test an event happened in: its file (absolute) and its suite and test titles. */
export interface TraceTestId {
  readonly file: string;
  readonly titles: readonly string[];
}

/**
 * One test's raw events, as the recorder writes them (one JSON line each). Events outside any
 * test (module load, `beforeAll`) form records with no `test`.
 */
export interface TraceRecord {
  readonly test: TraceTestId | undefined;
  readonly events: readonly RawTraceEvent[];
  /** Events not kept because a limit was hit. */
  readonly dropped: number;
}

/** What the recorder saw; probe ids index the plan's probes, frames number function calls. */
export type RawTraceEvent =
  | {
      readonly kind: 'enter';
      readonly seq: number;
      readonly frame: number;
      readonly parent: number | undefined;
      readonly probe: number;
      readonly args: readonly ValueSummary[];
    }
  | {
      readonly kind: 'branch';
      readonly seq: number;
      readonly frame: number;
      readonly probe: number;
      readonly taken: boolean;
    }
  | {
      readonly kind: 'value' | 'caught';
      readonly seq: number;
      readonly frame: number;
      readonly probe: number;
      readonly value: ValueSummary;
    }
  | { readonly kind: 'mark'; readonly seq: number; readonly frame: number; readonly probe: number }
  | {
      readonly kind: 'loop';
      readonly seq: number;
      readonly frame: number;
      readonly probe: number;
      readonly iterations: number;
    }
  | {
      readonly kind: 'return';
      readonly seq: number;
      readonly frame: number;
      /** The `return` probe, or `undefined` when the function ran off its end. */
      readonly probe: number | undefined;
      readonly value: ValueSummary;
    }
  | {
      readonly kind: 'throw';
      readonly seq: number;
      readonly frame: number;
      /** The `throw` probe when the function threw the value itself. */
      readonly probe: number | undefined;
      readonly value: ValueSummary;
    };
