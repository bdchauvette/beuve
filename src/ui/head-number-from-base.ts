import type { DiffFileView } from '#contract/ipc-contract.ts';

import { firstHunkLine } from './first-hunk-line.ts';

/**
 * The head line (1-based) that base line `line` of `file` became: the same line for unchanged
 * lines inside or between hunks, and for a deleted line the head line just before the gap (line
 * 1 at the top of the file). `undefined` for a deleted file, which has no head side. Pure.
 */
export function headNumberFromBase(file: DiffFileView, line: number): number | undefined {
  if (file.status === 'deleted') {
    return undefined;
  }
  let hunkIndex = -1;
  let oldLine = 0;
  let newLine = 0;
  let isInHunk = false;
  for (const text of file.patch.split('\n')) {
    if (text.startsWith('@@ ')) {
      hunkIndex += 1;
      const hunk = file.hunks[hunkIndex];
      if (hunk === undefined) {
        break;
      }
      const start = firstHunkLine({ start: hunk.oldStart, count: hunk.oldCount });
      if (line < start) {
        break;
      }
      newLine = firstHunkLine({ start: hunk.newStart, count: hunk.newCount });
      oldLine = start;
      isInHunk = true;
      continue;
    }
    if (!isInHunk) {
      continue;
    }
    if (text.startsWith('-')) {
      if (oldLine === line) {
        return Math.max(1, newLine - 1);
      }
      oldLine += 1;
    } else if (text.startsWith('+')) {
      newLine += 1;
    } else if (text.startsWith(' ')) {
      if (oldLine === line) {
        return newLine;
      }
      oldLine += 1;
      newLine += 1;
    }
  }
  return Math.max(1, line + newLine - oldLine);
}
