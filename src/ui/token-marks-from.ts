/** What {@link tokenMarksFrom} reads of a highlighter token: its text, offset and inline style. */
export interface StyledToken {
  readonly content: string;
  readonly offset: number;
  readonly htmlStyle?: Readonly<Record<string, string>>;
}

/** One highlighted run of a suggestion field: offsets in its text and the inline style to mark it with. */
export interface TokenMark {
  readonly from: number;
  readonly to: number;
  /** The highlighter's own custom properties, as `@pierre/diffs` writes them on a diff's spans. */
  readonly style: string;
}

/**
 * Mark decorations for a suggestion field from the tokens beuve's Shiki highlighter gives the
 * same text (ADR 0119, 0162): each styled token is a run from its absolute offset, its style the
 * `--diffs-token-*` properties the field's theme reads, so the field shows code as the diff does.
 * Tokens without a style are left plain. Pure.
 */
export function tokenMarksFrom(tokens: readonly (readonly StyledToken[])[]): TokenMark[] {
  const marks: TokenMark[] = [];
  for (const token of tokens.flat()) {
    const style = Object.entries(token.htmlStyle ?? {})
      .map(([property, value]) => `${property}:${value}`)
      .join(';');
    if (style !== '' && token.content !== '') {
      marks.push({ from: token.offset, to: token.offset + token.content.length, style });
    }
  }
  return marks;
}
