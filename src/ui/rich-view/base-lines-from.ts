import type { ChangeRun } from './change-run.ts';
import type { LineRange } from './line-range.ts';

/**
 * The base lines head lines `head` came from (ADR 0123): unchanged lines by their offset, lines a
 * run added by the lines it removed (or the gap they fill), so removals inside the range are
 * inside the result. `undefined` when they came from no base line (all added). Needs runs that
 * know their base side. Pure.
 */
export function baseLinesFrom(head: LineRange, runs: readonly ChangeRun[]): LineRange | undefined {
  const start = baseLineOf(head.start, runs).start;
  const end = baseLineOf(head.end, runs).end;
  if (start > end) {
    return undefined;
  }
  return { start, end };
}

/** The base lines head line `line` maps to: one line, or an empty gap (`start > end`). */
function baseLineOf(line: number, runs: readonly ChangeRun[]): LineRange {
  let delta = 0;
  for (const run of runs) {
    const { head, base } = run;
    const headCount = count(head);
    const baseCount = count(base);
    if (head !== undefined && head.start <= line && line <= head.end) {
      if (base !== undefined) {
        return base;
      }
      const after = head.start - delta;
      return { start: after, end: after - 1 };
    }
    if (run.headAfter > line) {
      break;
    }
    delta += headCount - baseCount;
  }
  return { start: line - delta, end: line - delta };
}

function count(range: LineRange | undefined): number {
  if (range === undefined) {
    return 0;
  }
  return range.end - range.start + 1;
}
