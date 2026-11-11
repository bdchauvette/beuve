/** Columns of one line, 0-based UTF-16, the end exclusive. */
export interface LinkColumns {
  readonly start: number;
  readonly end: number;
}

/** A token element: the column where its text starts on the line, and how many UTF-16 units it holds. */
export interface ElementColumns {
  readonly start: number;
  readonly length: number;
}

/**
 * The part of `link` that lies inside the element, as offsets into its text, or `undefined` when
 * they share no text. The highlighter merges neighboring text of one color into one element, so
 * the language server's identifier is usually a slice of it, and may run past its ends.
 */
export function linkOffsetsIn(link: LinkColumns, element: ElementColumns): LinkColumns | undefined {
  const start = Math.max(link.start - element.start, 0);
  const end = Math.min(link.end - element.start, element.length);
  if (start >= end) {
    return undefined;
  }
  return { start, end };
}
