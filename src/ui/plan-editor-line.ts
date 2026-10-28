import type { DiffFileView } from '#contract/ipc-contract.ts';

import { findFirstChangedLine } from './find-first-changed-line.ts';
import type { SelectedLines } from './plan-stage-anchor.ts';

/**
 * The head-side line `o` opens in the editor (1-based): the start of the selected lines; for
 * selected deleted lines, the first change of the hunk that held them (so the nearest head line);
 * otherwise the first changed line of the focused hunk, else of the file, else line 1.
 */
export function planEditorLine(
  file: DiffFileView,
  activeHunk: number,
  selection: SelectedLines | undefined,
): number {
  const hunkLine = (index: number): number | undefined =>
    findFirstChangedLine(file.patch, index) ?? file.hunks[index]?.newStart;
  if (selection !== undefined) {
    const first = Math.min(selection.start, selection.end);
    if ((selection.side ?? 'additions') === 'additions') {
      return Math.max(1, first);
    }
    const index = file.hunks.findIndex(
      (hunk) => first >= hunk.oldStart && first < hunk.oldStart + Math.max(1, hunk.oldCount),
    );
    const line = index === -1 ? undefined : hunkLine(index);
    if (line !== undefined) {
      return Math.max(1, line);
    }
  }
  const line =
    (activeHunk === -1 ? undefined : hunkLine(activeHunk)) ?? findFirstChangedLine(file.patch);
  return Math.max(1, line ?? 1);
}
