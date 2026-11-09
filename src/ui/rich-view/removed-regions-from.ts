import type { ChangeRun } from './change-run.ts';
import type { LineRange } from './line-range.ts';

/** A base region whose every line was removed, and the head line it is shown before. */
export interface RemovedRegion {
  readonly lines: LineRange;
  readonly headAt: number;
}

/** The regions of the base side and the change runs between base and head. */
export interface RemovedRegionsInput {
  readonly baseRegions: readonly LineRange[];
  readonly runs: readonly ChangeRun[];
}

/**
 * The base regions whose every line was removed (ADR 0123), each placed where its run is on the
 * head: before the lines the run added, or before the line after the gap. Pure.
 */
export function removedRegionsFrom({ baseRegions, runs }: RemovedRegionsInput): RemovedRegion[] {
  const removed: RemovedRegion[] = [];
  for (const lines of baseRegions) {
    const run = runs.find(({ base }) => {
      return base !== undefined && base.start <= lines.start && lines.start <= base.end;
    });
    if (run === undefined || !isEveryLineRemoved(lines, runs)) {
      continue;
    }
    removed.push({ lines, headAt: run.head?.start ?? run.headAfter });
  }
  return removed;
}

function isEveryLineRemoved(lines: LineRange, runs: readonly ChangeRun[]): boolean {
  for (let line = lines.start; line <= lines.end; line += 1) {
    const isRemoved = runs.some(({ base }) => {
      return base !== undefined && base.start <= line && line <= base.end;
    });
    if (!isRemoved) {
      return false;
    }
  }
  return true;
}
