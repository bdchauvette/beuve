import type { ChatMessageView, ChatStreamEvent } from '#contract/ipc-contract.ts';

/**
 * One item of the chat drawer's transcript. `message` entries are the session's stored Q&A,
 * `/review` and `/summarize` answers included (ADR 0031, 0055, 0056); `input` and `note` entries
 * are this window's command echoes and results, kept in memory. `input` echoes what the reviewer
 * typed.
 */
export type ChatEntry =
  | MessageChatEntry
  | { readonly id: number; readonly kind: 'input'; readonly text: string }
  | {
      readonly id: number;
      readonly kind: 'note';
      readonly tone: 'info' | 'error';
      readonly lines: readonly string[];
    }
  /** A `/compact` in flight, or how it failed (ADR 0047); the stored summary replaces it. */
  | {
      readonly id: number;
      readonly kind: 'compaction';
      readonly status: 'running' | 'failed';
      readonly message?: string;
    };

/** The entries this window makes up itself: command echoes, notes and compactions. */
export type LocalChatEntry = Exclude<ChatEntry, MessageChatEntry>;

/** A question or answer of the stored transcript; its `id` is the message's. */
export interface MessageChatEntry {
  readonly id: string;
  readonly kind: 'message';
  /** Built from `chat:stream` events while the request runs (ADR 0072), then the stored one. */
  readonly message: ChatMessageView;
  /** The latest coarse status line of a running request (`/review`'s), never content. */
  readonly activity?: string;
}

/** The transcript plus stream events that arrived before their message was known. */
export interface ChatTranscript {
  readonly entries: readonly ChatEntry[];
  /** By message id: events that beat the `chat:ask` response, replayed in order when it lands. */
  readonly pending: Readonly<Record<string, readonly ChatStreamEvent[]>>;
}
