import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { buildChatPrompt } from './build-chat-prompt.ts';
import type { ChatPromptBudget, ChatPromptReport } from './build-chat-prompt.ts';
import type { Citation } from './chat-message.ts';
import type { ChatDelta, ChatModel, ChatModelProgress } from './chat-model.ts';
import type { ChatQuestion } from './chat-question.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';
import { parseCitations } from './parse-citations.ts';
import { citablePathsFrom } from './citable-paths-from.ts';
import { validateCitations } from './validate-citations.ts';
import type { DroppedCitation } from './validate-citations.ts';

/** `E` is the model adapter's error type. */
export interface AskQuestionDeps<E> {
  readonly model: ChatModel<E>;
  readonly signal?: AbortSignal;
  /** The answer as it streams, when the adapter streams. */
  readonly onDelta?: (delta: ChatDelta) => void;
  readonly onProgress?: (progress: ChatModelProgress) => void;
  readonly budget?: ChatPromptBudget;
  /** Defaults to 5 minutes. */
  readonly timeout?: Temporal.Duration;
}

export interface ChatAnswer {
  /** Markdown whose only citation markers are `citations` (see `validateCitations`). */
  readonly answer: string;
  readonly citations: readonly Citation[];
  readonly dropped: readonly DroppedCitation[];
  readonly malformedCitations: number;
  readonly prompt: ChatPromptReport;
  readonly usage: {
    readonly model: string | undefined;
    readonly turns: number | undefined;
    readonly costUsd: number | undefined;
    readonly duration: Temporal.Duration;
    readonly deniedToolUses: number;
  };
}

/** Why a question got no answer. `model` wraps the adapter's own failure (cancellation included). */
export type ChatError<E> =
  | { readonly kind: 'empty-question' }
  | { readonly kind: 'question-too-long'; readonly maxChars: number }
  | { readonly kind: 'model'; readonly error: E };

/**
 * Answers one read-only question about a reviewed change (Zone 4, ADR 0031), or runs `/summarize`
 * (a `task` of kind `abstract`, ADR 0056, which needs no question): builds the bounded
 * prompt, asks the model in the head worktree, and validates the answer's citations against the
 * diff's and the worktree's files. Pure apart from the model port. Persisting the transcript,
 * one question in flight per session and cancellation are main's job.
 */
export async function askQuestion<E>(
  input: ChatQuestion,
  deps: AskQuestionDeps<E>,
): Promise<Result<ChatAnswer, ChatError<E>>> {
  const budget = deps.budget ?? defaultChatPromptBudget;
  const question = input.question.trim();
  if (question === '' && input.task === undefined) {
    return err({ kind: 'empty-question' });
  }
  if (input.task === undefined && question.length > budget.maxQuestionChars) {
    return err({ kind: 'question-too-long', maxChars: budget.maxQuestionChars });
  }
  const built = buildChatPrompt(input, budget);
  const output = await deps.model.runText({
    system: built.system,
    prompt: built.prompt,
    cwd: input.worktreePath,
    timeout: deps.timeout ?? Temporal.Duration.from({ minutes: 5 }),
    ...(deps.signal !== undefined && { signal: deps.signal }),
    ...(deps.onProgress !== undefined && { onProgress: deps.onProgress }),
    ...(deps.onDelta !== undefined && { onText: deps.onDelta }),
  });
  if (!output.ok) {
    return err({ kind: 'model', error: output.error });
  }
  const knownPaths = citablePathsFrom(input.files, input.worktreePaths);
  const answer = output.value.value.trim();
  const validated = validateCitations(answer, parseCitations(answer), {
    knownPaths,
    worktreePath: input.worktreePath,
  });
  const { model, turns, costUsd, duration, deniedToolUses } = output.value;
  return ok({
    answer: validated.content,
    citations: validated.citations,
    dropped: validated.dropped,
    malformedCitations: validated.malformed,
    prompt: built.report,
    usage: { model, turns, costUsd, duration, deniedToolUses },
  });
}
