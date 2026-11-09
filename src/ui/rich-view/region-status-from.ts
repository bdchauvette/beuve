import type { ChangeRun } from './change-run.ts';
import type { LineRange } from './line-range.ts';

/** How a rendered region differs from the review base (ADR 0123). */
export type RegionStatus = 'unchanged' | 'added' | 'modified' | 'removed';

/**
 * The status of a head region with source lines `lines`, from the hunks' change runs: `added`
 * when every line was added, `modified` when some were or lines were removed inside it, else
 * `unchanged`. Pure.
 */
export function regionStatusFrom(
  lines: LineRange,
  runs: readonly ChangeRun[],
): Exclude<RegionStatus, 'removed'> {
  let added = 0;
  let isTouched = false;
  for (const run of runs) {
    const { head } = run;
    if (head === undefined) {
      isTouched ||= run.headAfter > lines.start && run.headAfter <= lines.end;
      continue;
    }
    const overlap = Math.min(head.end, lines.end) - Math.max(head.start, lines.start) + 1;
    if (overlap <= 0) {
      continue;
    }
    added += overlap;
    isTouched = true;
  }
  if (added === lines.end - lines.start + 1) {
    return 'added';
  }
  if (isTouched) {
    return 'modified';
  }
  return 'unchanged';
}
