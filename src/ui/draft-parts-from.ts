import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { DraftPart } from './chat-draft.ts';

const token = /\[\[@([1-9]\d?)\]\]/gu;

/**
 * A stored question back as parts: each `[[@n]]` naming one of `mentions` becomes its chip, any
 * other text stays text. For the transcript and for putting a refused question back. Pure.
 */
export function draftPartsFrom(text: string, mentions: readonly ChatMentionView[]): DraftPart[] {
  const parts: DraftPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const mention = mentions[Number(match[1]) - 1];
    if (mention === undefined) {
      continue;
    }
    if (match.index > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    parts.push({ kind: 'mention', mention });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) });
  }
  return parts;
}
