/**
 * A token the pointer is over, in a diff card or a sheet. `lineCharStart` is the 0-based UTF-16
 * column where the token's element starts; the character under the pointer is found inside it
 * when the pointer comes to rest (`BeuveHoverCard`), since the highlighter merges neighbouring
 * text of one color into one element.
 */
export interface HoverPoint {
  /** Repository-relative path with `/` separators. */
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  readonly lineCharStart: number;
  readonly tokenElement: HTMLElement;
  readonly clientX: number;
  readonly clientY: number;
}
