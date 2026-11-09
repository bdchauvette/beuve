import type { SheetMarksView } from '#contract/ipc-contract.ts';

import type { ChangeRun } from './change-run.ts';

/**
 * Change runs from a sheet's gutter marks (ADR 0067, 0123), which know only the head side: added
 * and modified spans add lines (a modified one also removes some), and a removal mark sits at
 * the head line below its gap. Pure.
 */
export function changeRunsFromMarks(marks: SheetMarksView): ChangeRun[] {
  const runs: ChangeRun[] = [
    ...marks.added.map(({ startLine, endLine }): ChangeRun => {
      return { head: { start: startLine, end: endLine }, headAfter: endLine + 1, removes: false };
    }),
    ...marks.modified.map(({ startLine, endLine }): ChangeRun => {
      return { head: { start: startLine, end: endLine }, headAfter: endLine + 1, removes: true };
    }),
    ...marks.deletedAt.map((line): ChangeRun => {
      return { headAfter: line, removes: true };
    }),
  ];
  return runs.toSorted((a, b) => a.headAfter - b.headAfter);
}
