import type {
  ChatMessageView,
  InsightStatusView,
  ReviewRunErrorView,
  ReviewRunSummaryView,
} from '#contract/ipc-contract.ts';

/**
 * One item of the chat drawer's transcript. `message` entries are the session's stored Q&A
 * (ADR 0031); `input`, `note` and `review` entries are this window's command echoes and results,
 * kept in memory. `input` echoes what the reviewer typed.
 */
export type ChatEntry =
  | ReviewChatEntry
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

/** The entries this window makes up itself: command echoes, notes and review runs. */
export type LocalChatEntry = Exclude<ChatEntry, MessageChatEntry>;

/** A question or answer of the stored transcript; its `id` is the message's. */
export interface MessageChatEntry {
  readonly id: string;
  readonly kind: 'message';
  readonly message: ChatMessageView;
}

/** The transcript plus streamed text that arrived before its message was known. */
export interface ChatTranscript {
  readonly entries: readonly ChatEntry[];
  /** By message id: events that beat the `chat:ask` response, replayed when it lands. */
  readonly pending: Readonly<Record<string, PendingAnswer>>;
}

export interface PendingAnswer {
  /** The raw text streamed so far. */
  readonly text: string;
  /** The final state, if the answer finished before the response landed. */
  readonly settled?: ChatMessageView;
}

/** A `/review` command and what became of its run. */
export interface ReviewChatEntry {
  readonly id: number;
  readonly kind: 'review';
  readonly sessionId: string;
  /** Set once `review:run` answered; keys the `review:progress` events. */
  readonly runId?: string;
  readonly status: 'requesting' | 'running' | 'completed' | 'failed';
  /** The run was already in flight (`attached`) or stored (`reused`). */
  readonly joined?: 'attached' | 'reused';
  readonly progress?: string;
  readonly summary?: ReviewRunSummaryView;
  readonly error?:
    ReviewRunErrorView | { readonly code: 'request-failed'; readonly message: string };
  readonly citations: readonly ChatCitation[];
}

/** A pill in the transcript that jumps the diff stream to an insight. */
export interface ChatCitation {
  readonly insightId: string;
  readonly path: string;
  readonly line: number;
  readonly title: string;
  readonly severity: 'info' | 'warning' | 'risk';
  readonly status: InsightStatusView;
}
