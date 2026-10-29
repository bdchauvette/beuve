import type { ChatEntry } from './chat-entry.ts';

/** Where the transcript folds (ADR 0047). */
export interface TranscriptCompaction {
  /** Index of the latest summary among the entries, or -1 when nothing was compacted. */
  readonly boundary: number;
  /** Questions, answers and older summaries before it, which the divider counts. */
  readonly compactedMessages: number;
}

/**
 * The drawer keeps every earlier message but folds those before the latest summary under one
 * "Compacted · N messages" divider. Pure.
 */
export function planTranscriptCompaction(entries: readonly ChatEntry[]): TranscriptCompaction {
  const boundary = entries.findLastIndex(
    (entry) => entry.kind === 'message' && entry.message.role === 'summary',
  );
  const compactedMessages =
    boundary === -1
      ? 0
      : entries.slice(0, boundary).filter((entry) => entry.kind === 'message').length;
  return { boundary, compactedMessages };
}
