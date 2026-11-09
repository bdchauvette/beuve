import type { LineRange } from './line-range.ts';

/**
 * One run of changed lines between context (ADR 0123): the head lines it adds and the base lines
 * it removes, either of which may be absent, and the first head line after it, where a run that
 * only removes sits (one past the last line at the end of the file).
 */
export interface ChangeRun {
  readonly head?: LineRange;
  /** Absent for a run that only adds, and when only the head side is known (a sheet's marks). */
  readonly base?: LineRange;
  readonly headAfter: number;
  /** Whether the run removes lines, known even when its base lines are not. */
  readonly removes: boolean;
}
