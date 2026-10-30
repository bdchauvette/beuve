import type { ChatMention, ChatPart } from './chat-message.ts';
import { mentionKeyOf } from './mention-key-of.ts';

/** A question's distinct mentions in order of first appearance, as `chatTextFrom` numbers them. */
export function chatMentionsFrom(parts: readonly ChatPart[]): ChatMention[] {
  const seen = new Set<string>();
  return parts.flatMap((part): ChatMention[] => {
    if (part.kind !== 'mention' || seen.has(mentionKeyOf(part.mention))) {
      return [];
    }
    seen.add(mentionKeyOf(part.mention));
    return [part.mention];
  });
}
