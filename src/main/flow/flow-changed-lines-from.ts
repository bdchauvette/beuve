import type { DiffFile } from '#internal/git/diff-model.ts';

/**
 * The head lines to mark: added lines, and for a pure deletion the head lines either side of the
 * gap. A removal followed directly by added lines is an edit and marks only the added ones.
 */
export function flowChangedLinesFrom(file: Pick<DiffFile, 'hunks'>): Set<number> {
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    let nextLine = hunk.newStart;
    if (hunk.newCount === 0) {
      nextLine += 1;
    }
    for (const [index, line] of hunk.lines.entries()) {
      if (line.kind === 'removed') {
        const following = hunk.lines[index + 1]?.kind;
        if (following !== 'removed' && following !== 'added') {
          lines.add(Math.max(1, nextLine - 1));
          lines.add(nextLine);
        }
        continue;
      }
      if (line.kind === 'added') {
        lines.add(line.newLine);
      }
      nextLine = line.newLine + 1;
    }
  }
  return lines;
}
