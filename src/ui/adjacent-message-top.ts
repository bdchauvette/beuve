/** Where the chat transcript is scrolled, and where its messages start, in the same pixels. */
export interface TranscriptPosition {
  /** Each message's top edge from the top of the scrolled content, in document order. */
  readonly tops: readonly number[];
  /** The scroll offset the reading starts at. */
  readonly scrollTop: number;
  readonly step: -1 | 1;
}

/** Less than this apart, a message counts as the one the view already starts at. */
const tolerance = 2;

/**
 * The top of the message Next Message (`1`) or Previous Message (`-1`) scrolls to: the first one
 * that starts below the view's top, or the last one that starts above it, so a long answer read
 * halfway goes back to its own start first. `undefined` past either end. Pure.
 */
export function adjacentMessageTop({
  tops,
  scrollTop,
  step,
}: TranscriptPosition): number | undefined {
  if (step === 1) {
    return tops.find((top) => top > scrollTop + tolerance);
  }
  return tops.findLast((top) => top < scrollTop - tolerance);
}
