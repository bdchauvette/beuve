import { placeNoteOnDiff } from './place-note-on-diff.ts';
import type { HeadSideRange, NotePlacement, ShownLines } from './place-note-on-diff.ts';

/**
 * A line annotation as `@pierre/diffs` takes it: on the head side, after `lineNumber`, or above the
 * first hunk when `lineNumber` is 0 (a file-level annotation).
 */
export interface HeadSideAnnotation<T> {
  readonly side: 'additions';
  readonly lineNumber: number;
  readonly metadata: PlacedNote<T>;
}

/** A note and where {@link placeNoteOnDiff} put it. */
export interface PlacedNote<T> {
  readonly note: T;
  readonly placement: NotePlacement;
}

/**
 * Places notes (staged URA markers, insights, the composer) as line annotations (ADR 0025): after
 * the last head line of the note's range the diff shows, so the annotation sits under the code it
 * talks about. A range the diff doesn't show sits above the collapsed gap that holds it, where the
 * card offers to reveal it. Notes keep their order within a line.
 */
export function headSideAnnotationsFrom<T extends HeadSideRange>(
  shown: ShownLines,
  notes: readonly T[],
): HeadSideAnnotation<T>[] {
  return notes.map((note) => {
    const placement = placeNoteOnDiff(shown, note);
    return { side: 'additions', lineNumber: placement.after, metadata: { note, placement } };
  });
}
