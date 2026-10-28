import type { ChatMessage } from './chat-message.ts';
import type { ChatTurn } from './chat-question.ts';

/**
 * The earlier turns to send with the next question: questions and completed answers, oldest
 * first. Notices and unfinished, failed or cancelled answers are left out; `buildChatPrompt`
 * bounds the rest.
 */
export function toChatHistory(messages: readonly ChatMessage[]): ChatTurn[] {
  return messages.flatMap((message): ChatTurn[] => {
    if (message.role === 'user') {
      return [{ role: 'user', content: message.content }];
    }
    if (message.role === 'assistant' && message.status === 'complete') {
      return [{ role: 'assistant', content: message.content }];
    }
    return [];
  });
}
