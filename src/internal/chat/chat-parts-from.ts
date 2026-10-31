import type { ChatMention, ChatPart } from './chat-message.ts';

/**
 * The parts of a typed message (ADR 0072): text, with each `[[@n]]` that names one of `mentions`
 * as a `mention` part where it stands (ADR 0046). A token naming no mention stays text; a
 * mention no token names follows the text, so none is lost. Empty text makes no part. Pure.
 */
export function chatPartsFrom(text: string, mentions: readonly ChatMention[] = []): ChatPart[] {
  const parts: ChatPart[] = [];
  const named = new Set<number>();
  const nextId = (): string => `p${String(parts.length + 1)}`;
  let rest = '';
  for (const piece of text.split(mentionToken)) {
    const index = mentionIndexOf(piece);
    if (index === undefined) {
      rest += piece;
      continue;
    }
    const mention = mentions[index];
    if (mention === undefined) {
      rest += piece;
      continue;
    }
    if (rest !== '') {
      parts.push({ kind: 'text', id: nextId(), text: rest });
      rest = '';
    }
    named.add(index);
    parts.push({ kind: 'mention', id: nextId(), mention });
  }
  if (rest !== '') {
    parts.push({ kind: 'text', id: nextId(), text: rest });
  }
  for (const [index, mention] of mentions.entries()) {
    if (!named.has(index)) {
      parts.push({ kind: 'mention', id: nextId(), mention });
    }
  }
  return parts;
}

/** Splits text around `[[@n]]` tokens, keeping each token as its own piece. */
const mentionToken = /(\[\[@[1-9]\d{0,2}\]\])/u;

const wholeToken = /^\[\[@([1-9]\d{0,2})\]\]$/u;

function mentionIndexOf(piece: string): number | undefined {
  const found = wholeToken.exec(piece);
  if (found?.[1] === undefined) {
    return undefined;
  }
  return Number(found[1]) - 1;
}
