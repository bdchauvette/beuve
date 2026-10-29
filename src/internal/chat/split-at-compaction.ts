import type { ChatMessage, ChatMessageBase } from './chat-message.ts';

export interface CompactionSplit {
  /** The latest `/compact` summary, if the transcript has one. */
  readonly summary: (ChatMessageBase & { readonly role: 'summary' }) | undefined;
  /** Everything the summary replaces: every message before it, older summaries included. */
  readonly before: readonly ChatMessage[];
  /** The messages after it, which prompts still send turn by turn. */
  readonly after: readonly ChatMessage[];
}

/**
 * Splits a transcript at its compaction boundary (ADR 0047): the latest summary. Without one,
 * nothing is compacted and every message is `after`. Pure.
 */
export function splitAtCompaction(messages: readonly ChatMessage[]): CompactionSplit {
  const index = messages.findLastIndex((message) => message.role === 'summary');
  const summary = messages[index];
  if (summary?.role !== 'summary') {
    return { summary: undefined, before: [], after: messages };
  }
  return {
    summary: { ...summary, role: 'summary' },
    before: messages.slice(0, index),
    after: messages.slice(index + 1),
  };
}
