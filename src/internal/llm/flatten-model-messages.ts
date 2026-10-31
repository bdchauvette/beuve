import type { ModelMessage } from './language-model.ts';

/**
 * One prompt for a backend that takes a single user turn (the Claude Code CLI and Agent SDK
 * adapters, ADR 0070). User messages are joined as they are; when the conversation holds an
 * answer, every turn is headed by its speaker so the order stays readable.
 */
export function flattenModelMessages(messages: readonly ModelMessage[]): string {
  const hasAnswers = messages.some((message) => message.role === 'assistant');
  return hasAnswers
    ? messages
        .map((message) => {
          return `${message.role === 'user' ? '## User' : '## Assistant'}\n\n${message.content}`;
        })
        .join('\n\n')
    : messages.map((message) => message.content).join('\n');
}
