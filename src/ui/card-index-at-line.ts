/** Where a card sits along the stream's block axis, in viewport coordinates. */
export interface CardSpan {
  readonly blockStart: number;
  readonly blockEnd: number;
}

/**
 * The index of the card a reader is on when the stream's top edge is at `line`: the first card
 * still showing below it (its sticky header is the one pinned there), or -1 when none is.
 */
export function cardIndexAtLine(spans: readonly CardSpan[], line: number): number {
  return spans.findIndex((span) => {
    return span.blockEnd > line;
  });
}
