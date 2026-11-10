import { sheetRangeFrom } from './sheet-range-from.ts';
import type { SheetPlace } from './step-sheet-history.ts';
import type { LineRange, ReviewTarget } from './target-from.ts';

/**
 * Where Open in Sheet opens the diff's target at the head (ADR 0128): its file, on the head lines
 * it points at (a selection's or hunk's head range, a jump's line, the file's first change).
 * `undefined` with no active file, or for a deleted one, which the head doesn't have. Pure.
 */
export function sheetPlaceFrom(target: ReviewTarget): SheetPlace | undefined {
  if (target.kind === 'change' || target.file.status === 'deleted') {
    return undefined;
  }
  const lines = headLinesOf(target);
  if (lines === undefined) {
    return { path: target.file.path, range: undefined };
  }
  return { path: target.file.path, range: sheetRangeFrom(lines) };
}

function headLinesOf(target: Exclude<ReviewTarget, { kind: 'change' }>): LineRange | undefined {
  switch (target.kind) {
    case 'selection': {
      return target.head;
    }
    case 'hunk': {
      return target.head ?? { start: target.line, end: target.line };
    }
    case 'line': {
      return { start: target.line, end: target.line };
    }
    case 'file': {
      if (target.line === undefined) {
        return undefined;
      }
      return { start: target.line, end: target.line };
    }
  }
}
