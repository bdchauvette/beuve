import type { Brand } from '#pkg/brand/brand.ts';

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

/** One entry of a session's Q&A transcript (Zone 4), asked and answered at `headSha`. */
export type ChatMessage =
  | (ChatMessageBase & { readonly role: 'user' | 'system-notice' })
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
  readonly createdAt: string;
}

/** Where an assistant answer stands. Only `failed` carries a code (main's error code, e.g. `timeout`). */
export type AssistantState =
  | { readonly status: 'streaming' | 'complete' | 'cancelled' }
  | { readonly status: 'failed'; readonly errorCode: string };

export type AssistantStatus = AssistantState['status'];

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
