import { tailOf } from '#x/text/tail-of.ts';

/** A text field's value and its caret, as UTF-16 offsets. */
export interface TextCaret {
  readonly text: string;
  readonly caret: number;
}

/** The `:name` being typed before the caret: `text.slice(start, end)`, colon included. */
export interface EmojiQuery {
  readonly start: number;
  readonly end: number;
  /** What follows the colon, lowercased. */
  readonly name: string;
}

/**
 * The emoji shortcode being typed just before the caret (ADR 0143): a colon, then two or more of
 * the characters shortcode names use (`a`–`z`, digits, `_`, `+`, `-`), at the start or after
 * anything but a letter, digit, `_` or another colon, so `10:30`, `a::b` and `https://` never
 * open the list. `undefined` when there is none. Pure.
 */
export function findEmojiQuery({ text, caret }: TextCaret): EmojiQuery | undefined {
  // The colon and the character before it, besides the name.
  const before = tailOf(text.slice(0, caret), maxQueryLength + 2);
  const match = queryPattern.exec(before);
  const name = match?.groups?.['name'];
  if (name === undefined) {
    return undefined;
  }
  return { start: caret - name.length - 1, end: caret, name: name.toLowerCase() };
}

/** Longer than any name in the table, the longest of which has 40 characters. */
const maxQueryLength = 48;
const queryPattern = /(?:^|[^\p{L}\p{N}_:]):(?<name>[\w+-]{2,48})$/u;
