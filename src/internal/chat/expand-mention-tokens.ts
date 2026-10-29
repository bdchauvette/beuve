import { formatMention } from './format-mention.ts';
import type { MentionPlace } from './format-mention.ts';

const token = /\[\[@([1-9]\d?)\]\]/gu;

/**
 * Replaces each `[[@n]]` in a question with `«selection n: path:start-end»`, naming the n-th of
 * `mentions` (ADR 0046). A token past the last mention is left as typed. Pure.
 */
export function expandMentionTokens(text: string, mentions: readonly MentionPlace[]): string {
  return text.replaceAll(token, (whole, digits: string) => {
    const index = Number(digits);
    const mention = mentions[index - 1];
    return mention === undefined
      ? whole
      : `«selection ${String(index)}: ${formatMention(mention)}»`;
  });
}
