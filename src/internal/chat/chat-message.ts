import type { Brand } from '#x/brand/brand.ts';

/** A chat message's id (a UUID). */
export type ChatMessageId = Brand<string, 'ChatMessageId'>;

/**
 * A review session's id. Structurally identical to the session domain's `SessionId`, so main
 * passes one for the other without either domain importing the other (ADR 0009).
 */
export type SessionId = Brand<string, 'SessionId'>;

/** A full, lowercase commit id; structurally identical to the git and session domains' brand. */
export type CommitSha = Brand<string, 'CommitSha'>;

/**
 * A line range an answer points at (ADR 0031): head-side, 1-based and inclusive, in a file of the
 * reviewed change or the head worktree. The UI renders it as a pill that jumps the diff stream.
 */
export interface Citation {
  /** Repository-relative, `/`-separated. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly side: 'head';
}

/**
 * Lines the reviewer attached to a question (ADR 0046): a range of one side of a file at a
 * commit, or the whole file when both lines are absent. 1-based and inclusive; `base` lines are
 * the base side's own numbers. The question's text refers to the n-th mention as `[[@n]]`.
 */
export interface ChatMention {
  /** Repository-relative, `/`-separated; the base side's own path for `base`. */
  readonly path: string;
  readonly side: 'head' | 'base';
  readonly startLine?: number;
  readonly endLine?: number;
  /** The commit whose text was selected: the session head, or the review's base. */
  readonly sha: CommitSha;
}

/**
 * One entry of a session's Q&A transcript (Zone 4), asked and answered at `headSha`. A `summary`
 * is a `/compact` note (ADR 0047): later prompts send it instead of every turn before it.
 */
export type ChatMessage =
  | (ChatMessageBase & { readonly role: 'user' | 'system-notice' | 'summary' })
  | (ChatMessageBase & { readonly role: 'assistant' } & AssistantState);

export interface ChatMessageBase {
  readonly id: ChatMessageId;
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  /**
   * Markdown. An assistant's finished answer contains only validated `[[path:start-end]]`
   * markers, each matching one of `citations`; while streaming it is the raw, unvalidated text.
   */
  readonly content: string;
  /** In order of first appearance; empty for user messages and notices. */
  readonly citations: readonly Citation[];
  /** What the question was about, in `[[@n]]` order; empty for everything but user messages. */
  readonly mentions: readonly ChatMention[];
  readonly createdAt: string;
}

/** Where an assistant answer stands. Only `failed` carries a code (main's error code, e.g. `timeout`). */
export type AssistantState =
  | { readonly status: 'streaming' | 'complete' | 'cancelled' }
  | { readonly status: 'failed'; readonly errorCode: string };

/** Expected failures of the chat repository. */
export type ChatStoreError =
  | { readonly kind: 'session-not-found'; readonly sessionId: SessionId }
  | { readonly kind: 'duplicate-message'; readonly id: ChatMessageId }
  | { readonly kind: 'message-not-found'; readonly id: ChatMessageId }
  | {
      readonly kind: 'corrupt-row';
      readonly table: 'chat_messages';
      readonly id: string;
      readonly reason: string;
    };
