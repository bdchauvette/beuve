import { findEmojiQuery } from './find-emoji-query.ts';
import type { TextCaret } from './find-emoji-query.ts';
import { matchEmojiShortcodes } from './match-emoji-shortcodes.ts';

/** Replace `text.slice(start, end)` with `insert`. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly insert: string;
}

/**
 * What typing a `:` at the caret does (ADR 0144): after `:name` where `name` is a shortcode
 * (any case), the edit that replaces `:name` with its emoji, so the colon is never typed;
 * otherwise `undefined`, and the colon is typed as usual. Pure.
 */
export function planClosingColon(field: TextCaret): TextEdit | undefined {
  const query = findEmojiQuery(field);
  if (query === undefined) {
    return undefined;
  }
  const [best] = matchEmojiShortcodes(query.name);
  if (best?.name !== query.name) {
    return undefined;
  }
  return { start: query.start, end: query.end, insert: best.emoji };
}
