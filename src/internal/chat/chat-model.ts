import type { Result } from '#x/result/result.ts';

/**
 * The chat domain's port to a language model, declared structurally (ADR 0030): the llm domain's
 * adapters satisfy it, but domains can't import each other, so main passes one in. `runText`
 * never rejects; its failure `E` is the adapter's own error type.
 */
export interface ChatModel<E> {
  readonly runText: (request: ChatModelRequest) => Promise<Result<ChatModelOutput, E>>;
}

export interface ChatModelRequest {
  readonly system: string;
  /** Never logged above debug level. */
  readonly prompt: string;
  /** The head worktree, which the model may read and must never write. */
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ChatModelProgress) => void;
  readonly onText?: (event: ChatDelta) => void;
}

export type ChatModelProgress =
  | { readonly kind: 'started'; readonly model: string | undefined }
  | { readonly kind: 'tool-use'; readonly tool: string };

/**
 * A streamed piece of the answer. `reset` drops what was streamed so far (text the model wrote
 * before a tool call). Streamed text is a raw preview; the validated answer replaces it.
 */
export type ChatDelta =
  { readonly kind: 'append'; readonly text: string } | { readonly kind: 'reset' };

export interface ChatModelOutput {
  readonly value: string;
  readonly model: string | undefined;
  readonly turns: number | undefined;
  readonly costUsd: number | undefined;
  readonly durationMs: number;
  readonly deniedToolUses: number;
}
