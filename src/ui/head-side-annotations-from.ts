import type { DiffHunkView } from '#contract/ipc-contract.ts';

/** Anything with a 1-based, inclusive head-side line range. */
export interface HeadSideRange {
  readonly lineStart: number;
  readonly lineEnd: number;
}

/**
 * A line annotation as `@pierre/diffs` takes it: on the head side, after `lineNumber`, or above the
 * first hunk when `lineNumber` is 0 (a file-level annotation).
 */
export interface HeadSideAnnotation<T> {
  readonly side: 'additions';
  readonly lineNumber: number;
  readonly metadata: T;
}

/**
 * Places notes (staged URA markers, the composer) as line annotations (ADR 0025): after the last
 * head line of the note's range the patch shows (every head line of a hunk is shown, context or
 * added), so the annotation sits under the code it talks about. Ranges no hunk shows become
 * file-level annotations. Notes keep their order within a line.
 */
export function headSideAnnotationsFrom<T extends HeadSideRange>(
  hunks: readonly DiffHunkView[],
  notes: readonly T[],
): HeadSideAnnotation<T>[] {
  return notes.map((note) => ({
    side: 'additions',
    lineNumber: lastShownLine(hunks, note) ?? 0,
    metadata: note,
  }));
}

function lastShownLine(hunks: readonly DiffHunkView[], range: HeadSideRange): number | undefined {
  let last: number | undefined;
  for (const hunk of hunks) {
    const hunkEnd = hunk.newStart + hunk.newCount - 1;
    if (hunk.newCount === 0 || range.lineEnd < hunk.newStart || range.lineStart > hunkEnd) {
      continue;
    }
    last = Math.max(last ?? 0, Math.min(range.lineEnd, hunkEnd));
  }
  return last;
}
