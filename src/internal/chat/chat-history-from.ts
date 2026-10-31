import { chatMentionsFrom } from './chat-mentions-from.ts';
import type { ChatMessage } from './chat-message.ts';
import type { ChatTurn } from './chat-question.ts';
import { chatTextFrom } from './chat-text-from.ts';
import { reviewMarkdownFrom } from './review-markdown-from.ts';
import { splitAtCompaction } from './split-at-compaction.ts';

/**
 * The earlier turns to send with the next question: questions (with their mentions) and
 * completed answers after the latest `/compact` summary, oldest first (ADR 0047); the summary
 * stands for the rest; a `/review` answer is its findings as Markdown (ADR 0072). Notices and
 * unfinished, failed or cancelled answers are left out; `buildChatPrompt` bounds the rest.
 */
export function chatHistoryFrom(messages: readonly ChatMessage[]): ChatTurn[] {
  return splitAtCompaction(messages).after.flatMap((message): ChatTurn[] => {
    if (message.role === 'user') {
      const mentions = chatMentionsFrom(message.parts);
      return [
        {
          role: 'user',
          content: chatTextFrom(message.parts),
          ...(mentions.length > 0 && { mentions }),
        },
      ];
    }
    if (message.role === 'assistant' && message.status === 'done') {
      if (message.review === undefined) {
        return [{ role: 'assistant', content: chatTextFrom(message.parts) }];
      }
      return [{ role: 'assistant', content: reviewMarkdownFrom(message.review) }];
    }
    return [];
  });
}
