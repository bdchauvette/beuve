import type { DiffHunkView } from '#contract/ipc-contract.ts';

import type { ChangeRun } from './change-run.ts';
import type { RegionTarget } from './region-target.ts';

/**
 * What a hunk points at in a rendered view (ADR 0123): the head lines its runs add, or, for a
 * hunk that only removes, the base lines it removes. Context lines don't count. `undefined`
 * when no run lies in the hunk. Pure.
 */
export function hunkTargetFrom(
  hunk: DiffHunkView,
  runs: readonly ChangeRun[],
): RegionTarget | undefined {
  const headEnd = hunk.newStart + Math.max(hunk.newCount, 1);
  const baseEnd = hunk.oldStart + Math.max(hunk.oldCount, 1);
  const inside = runs.filter((run) => {
    return run.headAfter >= hunk.newStart && run.headAfter <= headEnd;
  });
  const heads = inside.flatMap((run) => {
    if (run.head === undefined) {
      return [];
    }
    return [run.head];
  });
  const [firstHead] = heads;
  const lastHead = heads.at(-1);
  if (firstHead !== undefined && lastHead !== undefined) {
    return { side: 'head', lines: { start: firstHead.start, end: lastHead.end } };
  }
  const bases = inside.flatMap((run) => {
    if (run.base === undefined || run.base.start < hunk.oldStart || run.base.end > baseEnd) {
      return [];
    }
    return [run.base];
  });
  const [firstBase] = bases;
  const lastBase = bases.at(-1);
  if (firstBase === undefined || lastBase === undefined) {
    return undefined;
  }
  return { side: 'base', lines: { start: firstBase.start, end: lastBase.end } };
}
