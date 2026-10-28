import type { DiffFile } from '#internal/git/diff-model.ts';

import { toFlowChangedLines } from '../flow/to-flow-changed-lines.ts';

/**
 * The head lines the hunk around `line` changed, plus `line` itself, which the probe always
 * traces. With no hunk around the line (an agent asked about unchanged code) just that line.
 */
export function toHunkChangedLines(
  file: Pick<DiffFile, 'hunks'> | undefined,
  line: number,
): Set<number> {
  const hunk = file?.hunks.find(
    (candidate) =>
      line >= candidate.newStart &&
      line <= candidate.newStart + Math.max(candidate.newCount, 1) - 1,
  );
  const lines = hunk === undefined ? new Set<number>() : toFlowChangedLines({ hunks: [hunk] });
  lines.add(line);
  return lines;
}
