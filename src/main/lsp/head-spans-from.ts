import type { DiffFile } from '#internal/git/diff-model.ts';
import type { ChangedLineSpan, ChangedLines } from '#internal/lsp/badge-call-hierarchy-node.ts';

/**
 * The head-side lines each file of a review changed, for badging call hierarchy nodes: runs of
 * added lines, and for deletions the two head lines either side of the gap. Context lines don't
 * count. Deleted files have no head side and are left out.
 */
export function headSpansFrom(files: readonly DiffFile[]): ChangedLines {
  const spans = new Map<string, readonly ChangedLineSpan[]>();
  for (const file of files) {
    if (file.status === 'deleted') {
      continue;
    }
    spans.set(headPathOf(file), fileSpans(file));
  }
  return spans;
}

function headPathOf(file: DiffFile): string {
  if ('newPath' in file) {
    return file.newPath;
  }
  return file.path;
}

function fileSpans(file: DiffFile): ChangedLineSpan[] {
  const spans: ChangedLineSpan[] = [];
  const push = ({ startLine, endLine }: ChangedLineSpan): void => {
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
    let nextLine = hunk.newStart;
    if (hunk.newCount === 0) {
      nextLine += 1;
    }
    for (const line of hunk.lines) {
      if (line.kind === 'removed') {
        push({ startLine: Math.max(1, nextLine - 1), endLine: nextLine });
        continue;
      }
      if (line.kind === 'added') {
        push({ startLine: line.newLine, endLine: line.newLine });
      }
      nextLine = line.newLine + 1;
    }
  }
  return spans;
}
