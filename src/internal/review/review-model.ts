import type { z } from 'zod';

import type { Result } from '#pkg/result/result.ts';

/**
 * The review domain's port to a language model (ADR 0019), declared structurally (ADR 0030): the
 * llm domain's adapters satisfy it, but domains can't import each other, so main passes one in.
 * `run` never rejects; its failure `E` is the adapter's own error type, which the review passes
 * through untouched.
 */
export interface ReviewModel<E> {
  readonly run: <T>(request: ModelRequest<T>) => Promise<Result<ModelOutput<T>, E>>;
}

export interface ModelRequest<T> {
  /** Instructions appended to the backend's own system prompt. Not secret, but not logged at info. */
  readonly system: string;
  /** The user turn: the diff and context. Never logged above debug level. */
  readonly prompt: string;
  /** Absolute directory the model may read (the session worktree). It must never be written. */
  readonly cwd: string;
  /** The shape of the answer. Adapters send it as JSON Schema and validate the reply against it. */
  readonly outputSchema: z.ZodType<T>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Coarse progress for a status line. Carries no prompt or file content. */
  readonly onProgress?: (progress: ModelProgress) => void;
}

export type ModelProgress =
  | { readonly kind: 'started'; readonly model: string | undefined }
  | { readonly kind: 'tool-use'; readonly tool: string };

export interface ModelOutput<T> {
  readonly value: T;
  readonly model: string | undefined;
  readonly turns: number | undefined;
  readonly costUsd: number | undefined;
  readonly durationMs: number;
  readonly deniedToolUses: number;
}
