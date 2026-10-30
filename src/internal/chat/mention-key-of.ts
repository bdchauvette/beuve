import type { ChatMention } from './chat-message.ts';

/** Equal for mentions of the same lines of the same side and commit. */
export function mentionKeyOf(mention: ChatMention): string {
  return [
    mention.path,
    mention.side,
    String(mention.startLine ?? ''),
    String(mention.endLine ?? ''),
    mention.sha,
  ].join('\0');
}
