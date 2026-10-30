import type { Result } from '#x/result/result.ts';

/**
 * The chat domain's port to a language model, declared structurally (ADR 0030): the llm domain's
 * adapters satisfy it, but domains can't import each other, so main passes one in. `runText`
 * never rejects; its failure `E` is the adapter's own error type. Without `capabilities` the
 * model is taken to have tools and an unknown context window (ADR 0070).
 */
export interface ChatModel<E> {
  readonly capabilities?: ChatModelCapabilities;
  readonly runText: (request: ChatModelRequest) => Promise<Result<ChatModelOutput, E>>;
}

/** What the prompt builders need to know about the model (ADR 0070). */
export interface ChatModelCapabilities {
  /** Whether it can read the worktree; without tools, prompts never ask it to. */
  readonly tools: boolean;
  /** Prompt budgets derive from it; `undefined` keeps the defaults. */
  readonly contextWindowTokens: number | undefined;
}

/** One turn sent to the model; `cache` marks the end of the stable, cacheable prefix. */
export interface ChatModelMessage {
  readonly role: 'user' | 'assistant';
  /** Never logged above debug level. */
  readonly content: string;
  readonly cache?: boolean;
}

/** How hard the model thinks, as the request overrides it. */
export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatModelRequest {
  readonly system: string;
  readonly messages: readonly ChatModelMessage[];
  /** The head worktree, which the model may read and must never write. */
  readonly cwd: string;
  readonly timeout: Temporal.Duration;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ChatModelProgress) => void;
  readonly onText?: (event: ChatDelta) => void;
  readonly effort?: ChatEffort;
}

/** Coarse progress; a tool's `description` names what it reads, never what it found. */
export type ChatModelProgress =
  | { readonly kind: 'started'; readonly model: string | undefined }
  | { readonly kind: 'thinking'; readonly summary?: string }
  | {
      readonly kind: 'tool-start';
      readonly id: string;
      readonly tool: string;
      readonly description: string;
    }
  | { readonly kind: 'tool-end'; readonly id: string; readonly tool: string; readonly ok: boolean }
  | { readonly kind: 'text-start' }
  | { readonly kind: 'text-end' };

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
  readonly duration: Temporal.Duration;
  readonly deniedToolUses: number;
}
