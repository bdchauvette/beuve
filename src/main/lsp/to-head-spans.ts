import type { DiffFile } from '#internal/git/diff-model.ts';
import type { ChangedLineSpan, ChangedLines } from '#internal/lsp/badge-call-hierarchy-node.ts';

/**
 * The head-side lines each file of a review changed, for badging call hierarchy nodes: runs of
 * added lines, and for deletions the two head lines either side of the gap. Context lines don't
 * count. Deleted files have no head side and are left out.
 */
export function toHeadSpans(files: readonly DiffFile[]): ChangedLines {
  const spans = new Map<string, readonly ChangedLineSpan[]>();
  for (const file of files) {
    if (file.status === 'deleted') {
      continue;
    }
    const path = 'newPath' in file ? file.newPath : file.path;
    spans.set(path, fileSpans(file));
  }
  return spans;
}

function fileSpans(file: DiffFile): ChangedLineSpan[] {
  const spans: ChangedLineSpan[] = [];
  const push = (startLine: number, endLine: number): void => {
    const last = spans.at(-1);
    if (last !== undefined && startLine <= last.endLine + 1) {
      spans[spans.length - 1] = {
        startLine: last.startLine,
        endLine: Math.max(endLine, last.endLine),
      };
    } else {
      spans.push({ startLine, endLine });
    }
  };
  for (const hunk of file.hunks) {
    let nextLine = hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind === 'removed') {
        push(Math.max(1, nextLine - 1), nextLine);
        continue;
      }
      if (line.kind === 'added') {
        push(line.newLine, line.newLine);
      }
      nextLine = line.newLine + 1;
    }
  }
  return spans;
}
