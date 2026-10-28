import type { DiffFile } from '#internal/git/diff-model.ts';
import type { ChangedLines, LineRange } from '#internal/impact/impact-input.ts';

/**
 * The lines a diff file changes, as ImpactGate reads them: removed lines by base line number and
 * added lines by head line number, merged into inclusive runs.
 */
export function toChangedLines(file: Pick<DiffFile, 'hunks'>): ChangedLines {
  const base: number[] = [];
  const head: number[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'removed') {
        base.push(line.oldLine);
      } else if (line.kind === 'added') {
        head.push(line.newLine);
      }
    }
  }
  return { base: toRanges(base), head: toRanges(head) };
}

function toRanges(lines: readonly number[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of lines) {
    const last = ranges.at(-1);
    if (last !== undefined && line === last.end + 1) {
      ranges[ranges.length - 1] = { start: last.start, end: line };
    } else {
      ranges.push({ start: line, end: line });
    }
  }
  return ranges;
}
