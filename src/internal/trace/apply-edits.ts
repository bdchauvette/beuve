import type { SourceEdit } from './instrumentation-plan.ts';

/**
 * Applies insertions to `source`. At one offset, closings come before openings; closings of
 * smaller constructs first, openings of larger ones first, so nested wrappers stay balanced.
 */
export function applyEdits(source: string, edits: readonly SourceEdit[]): string {
  const sorted = edits.toSorted(compareEdits);
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of sorted) {
    const offset = Math.min(Math.max(edit.offset, cursor), source.length);
    parts.push(source.slice(cursor, offset), edit.text);
    cursor = offset;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

function compareEdits(left: SourceEdit, right: SourceEdit): number {
  if (left.offset !== right.offset) {
    return left.offset - right.offset;
  }
  if (left.side !== right.side) {
    if (left.side === 'close') {
      return -1;
    }
    return 1;
  }
  if (left.side === 'close') {
    if (left.span === right.span) {
      return right.order - left.order;
    }
    return left.span - right.span;
  }
  if (left.span === right.span) {
    return left.order - right.order;
  }
  return right.span - left.span;
}
