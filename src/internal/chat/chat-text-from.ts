import type { ChatPart } from './chat-message.ts';
import { mentionKeyOf } from './mention-key-of.ts';

/**
 * A message's text for a prompt or a URA note (ADR 0072): its text parts in order, with each
 * `mention` part as `[[@n]]`, `n` counting distinct mentions in order of first appearance (the
 * numbering {@link chatMentionsFrom} lists them in). Reasoning, tool calls, findings and errors
 * say nothing here. Pure.
 */
export function chatTextFrom(parts: readonly ChatPart[]): string {
  const numbers = new Map<string, number>();
  let text = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      text += part.text;
    } else if (part.kind === 'mention') {
      const key = mentionKeyOf(part.mention);
      const number = numbers.getOrInsertComputed(key, () => numbers.size + 1);
      text += `[[@${String(number)}]]`;
    }
  }
  return text;
}
