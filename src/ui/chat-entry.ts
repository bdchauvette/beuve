import type {
  InsightStatusView,
  ReviewRunErrorView,
  ReviewRunSummaryView,
} from '#contract/ipc-contract.ts';

/**
 * One item of the chat drawer's transcript (kept in memory; `chat_messages` persistence arrives
 * with Q&A). `input` echoes what the reviewer typed.
 */
export type ChatEntry =
  | ReviewChatEntry
  | { readonly id: number; readonly kind: 'input'; readonly text: string }
  | {
      readonly id: number;
      readonly kind: 'note';
      readonly tone: 'info' | 'error';
      readonly lines: readonly string[];
    };

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
