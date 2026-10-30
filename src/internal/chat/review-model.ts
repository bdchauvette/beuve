import type { z } from 'zod';

import type { Result } from '#x/result/result.ts';

import type {
  ChatEffort,
  ChatModelCapabilities,
  ChatModelMessage,
  ChatModelOutput,
  ChatModelProgress,
} from './chat-model.ts';

/**
 * The chat domain's port to a language model for structured answers (`/review` and its
 * verification pass, ADR 0055), declared structurally like {@link ChatModel} (ADR 0030): the llm
 * domain's adapters satisfy it. `run` never rejects; its failure `E` is the adapter's own error.
 */
export interface ReviewModel<E> {
  readonly capabilities?: ChatModelCapabilities;
  readonly run: <T>(request: ReviewModelRequest<T>) => Promise<Result<ReviewModelOutput<T>, E>>;
}

export interface ReviewModelRequest<T> {
  readonly system: string;
  readonly messages: readonly ChatModelMessage[];
  /** The head worktree, which the model may read and must never write. */
  readonly cwd: string;
  /** The shape of the answer. Adapters send it as JSON Schema and validate the reply against it. */
  readonly outputSchema: z.ZodType<T>;
  readonly timeout: Temporal.Duration;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: (progress: ChatModelProgress) => void;
  readonly effort?: ChatEffort;
}

export type ReviewModelOutput<T> = Omit<ChatModelOutput, 'value'> & { readonly value: T };
