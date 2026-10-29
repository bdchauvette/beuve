import type { ChatMessage } from './chat-message.ts';
import type { ChatTurn } from './chat-question.ts';
import { splitAtCompaction } from './split-at-compaction.ts';

/**
 * The earlier turns to send with the next question: questions (with their mentions) and
 * completed answers after the latest `/compact` summary, oldest first (ADR 0047); the summary
 * stands for the rest. Notices and unfinished, failed or cancelled answers are left out;
 * `buildChatPrompt` bounds the rest.
 */
export function toChatHistory(messages: readonly ChatMessage[]): ChatTurn[] {
  return splitAtCompaction(messages).after.flatMap((message): ChatTurn[] => {
    if (message.role === 'user') {
      return [
        {
          role: 'user',
          content: message.content,
          ...(message.mentions.length > 0 && { mentions: message.mentions }),
        },
      ];
    }
    if (message.role === 'assistant' && message.status === 'complete') {
      return [{ role: 'assistant', content: message.content }];
    }
    return [];
  });
}
