import type { Brand } from '#x/brand/brand.ts';

import type { ChatReview } from './chat-review.ts';

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
  | (ChatMessageBase & {
      readonly role: 'assistant';
      readonly kind: AnswerKind;
      /** The structured result of a completed `/review` (ADR 0055); absent otherwise. */
      readonly review?: ChatReview;
    } & AssistantState);

/**
 * What an assistant message answers: a question, `/review` (findings, ADR 0055) or `/summarize`
 * (beuve's own summary of the change, ADR 0056).
 */
export type AnswerKind = 'answer' | 'review' | 'abstract';

export interface ChatMessageBase {
  readonly id: ChatMessageId;
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  /**
   * What the message says, in order (ADR 0072). A question is text and `mention` parts; a notice
   * or a summary one text part; an answer any of text, reasoning, tool calls, findings and, when
   * it failed, an error.
   */
  readonly parts: readonly ChatPart[];
  /**
   * The validated `[[path:start-end]]` markers of the text parts, in order of first appearance;
   * empty for user messages and notices, and while an answer streams.
   */
  readonly citations: readonly Citation[];
  readonly createdAt: string;
}

/**
 * Where an assistant answer's request stands (ADR 0072): `queued` behind another request of its
 * session (ADR 0057), `submitted` once it runs and before any part arrived, `streaming` while
 * parts arrive, then `done`, `error` (its last part is the `error` part) or `cancelled`. Every
 * other message is `done`.
 */
export interface AssistantState {
  readonly status: ChatStatus;
}

export type ChatStatus = 'queued' | 'submitted' | 'streaming' | 'done' | 'error' | 'cancelled';

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

/**
 * One typed piece of a chat message (ADR 0072). A message is an ordered list of parts, stored as
 * it streams and once final, so a reloaded transcript has the same shape as a live one. `id` is
 * unique within its message (`p1`, `p2`, …) and never reused, also after a part is discarded.
 *
 * - `text`: Markdown. In a final answer its only `[[path:start-end]]` markers are the message's
 *   validated citations; while streaming it is the raw preview.
 * - `reasoning`: the model thought; `summary` only when the backend gives a short, content-free
 *   one.
 * - `tool-call`: a read-only tool the model ran, with what it looked at (`read src/a.ts:1-40`),
 *   never what it found.
 * - `mention`: lines the reviewer attached to a question, where the question names them.
 * - `finding`: the n-th (0-based) finding of the message's `/review` result.
 * - `error`: why the request failed; main's error code (`timeout`, …).
 */
export type ChatPart =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'reasoning';
      readonly id: string;
      readonly state: 'running' | 'done';
      readonly summary?: string;
    }
  | {
      readonly kind: 'tool-call';
      readonly id: string;
      readonly tool: string;
      readonly description: string;
      readonly state: ToolCallState;
    }
  | { readonly kind: 'mention'; readonly id: string; readonly mention: ChatMention }
  | { readonly kind: 'finding'; readonly id: string; readonly finding: number }
  | { readonly kind: 'error'; readonly id: string; readonly code: string };

/** `stopped`: the request ended (cancelled or failed) before the tool answered. */
export type ToolCallState = 'running' | 'done' | 'failed' | 'stopped';
