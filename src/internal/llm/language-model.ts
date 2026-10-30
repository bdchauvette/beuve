import type { z } from 'zod';

import type { Result } from '#x/result/result.ts';

/**
 * beuve's port to a language model (ADR 0019, 0030). Vendor-neutral: an adapter turns one request
 * into one agentic, read-only run in `cwd`. Neither method rejects; every failure is a
 * {@link ModelError}. Domains don't import this type (ADR 0002): each declares the structural
 * subset it needs, and main passes an adapter in.
 */
export interface LanguageModel {
  /** A structured answer that already matches `outputSchema` (the preliminary review). */
  readonly run: <T>(request: ModelRequest<T>) => Promise<Result<ModelOutput<T>, ModelError>>;
  /** A free-form Markdown answer (Q&A chat), optionally streamed as it is written. */
  readonly runText: (request: TextModelRequest) => Promise<Result<ModelOutput<string>, ModelError>>;
}

/** What every run needs, whatever the shape of its answer. */
export interface BaseModelRequest {
  /** Instructions appended to the backend's own system prompt. Not secret, but not logged at info. */
  readonly system: string;
  /** The user turn: the diff and context. Never logged above debug level. */
  readonly prompt: string;
  /** Absolute directory the model may read (the session worktree). It must never be written. */
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Coarse progress for a status line. Carries no prompt or file content. */
  readonly onProgress?: (progress: ModelProgress) => void;
}

export interface ModelRequest<T> extends BaseModelRequest {
  /** The shape of the answer. Adapters send it as JSON Schema and validate the reply against it. */
  readonly outputSchema: z.ZodType<T>;
}

export interface TextModelRequest extends BaseModelRequest {
  /**
   * The answer as it is written, when the backend streams. The final answer is the last assistant
   * message, so `reset` drops text written before a tool call. The streamed text is a preview:
   * only the run's result is authoritative.
   */
  readonly onText?: (event: TextStreamEvent) => void;
}

export type TextStreamEvent =
  { readonly kind: 'append'; readonly text: string } | { readonly kind: 'reset' };

export type ModelProgress =
  | { readonly kind: 'started'; readonly model: string | undefined }
  | { readonly kind: 'tool-use'; readonly tool: string };

export interface ModelOutput<T> {
  readonly value: T;
  /** The backend's model identifier, e.g. `claude-sonnet-5-5`, when it reports one. */
  readonly model: string | undefined;
  readonly turns: number | undefined;
  /** The backend's cost estimate; for subscription logins this is notional, not billed. */
  readonly costUsd: number | undefined;
  readonly durationMs: number;
  /** Tool calls the backend refused under the read-only policy. */
  readonly deniedToolUses: number;
}

/** Why a model run produced no usable output. Every variant is an expected failure. */
export type ModelError =
  | { readonly kind: 'invalid-request'; readonly reason: string }
  | { readonly kind: 'not-installed'; readonly command: string }
  | { readonly kind: 'not-authenticated'; readonly message: string }
  | {
      readonly kind: 'rate-limited';
      readonly message: string;
      readonly resetsAt: string | undefined;
    }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'output-too-large'; readonly maxBytes: number }
  | { readonly kind: 'invalid-output'; readonly reason: string }
  /** The backend ran but reported an error result (budget exhausted, execution error, …). */
  | { readonly kind: 'model-failed'; readonly reason: string; readonly message: string }
  | {
      readonly kind: 'process-failed';
      readonly exitCode: number | undefined;
      readonly signal: string | undefined;
      readonly stderr: string;
    };
