import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { buildCompactionPrompt } from './build-compaction-prompt.ts';
import type { ChatCompaction, CompactionBudget } from './build-compaction-prompt.ts';
import type { Citation } from './chat-message.ts';
import type { ChatModel } from './chat-model.ts';
import { parseCitations } from './parse-citations.ts';
import { citablePathsFrom } from './citable-paths-from.ts';
import { validateCitations } from './validate-citations.ts';
import type { DroppedCitation } from './validate-citations.ts';

export interface CompactConversationDeps<E> {
  readonly model: ChatModel<E>;
  readonly signal?: AbortSignal;
  readonly budget?: CompactionBudget;
  /** Defaults to 3 minutes. */
  readonly timeout?: Temporal.Duration;
}

/** The note that replaces the compacted turns. Its markers are all validated `citations`. */
export interface ChatSummary {
  readonly content: string;
  readonly citations: readonly Citation[];
  readonly dropped: readonly DroppedCitation[];
  readonly malformedCitations: number;
  /** Turns the prompt had to leave out, oldest first. */
  readonly omittedTurns: number;
}

export type CompactionError<E> =
  { readonly kind: 'nothing-to-compact' } | { readonly kind: 'model'; readonly error: E };

const defaultBudget: CompactionBudget = {
  maxTurnsChars: 120_000,
  maxTurnChars: 12_000,
  maxSummaryChars: 16_000,
  maxListedFiles: 200,
};

/**
 * Condenses a conversation into one note with the model (ADR 0047), read-only in the head
 * worktree, and validates its citations as answers' are (ADR 0031). Refuses when there is no turn
 * since the last summary. Pure apart from the model port; storing the note is main's job.
 */
export async function compactConversation<E>(
  input: ChatCompaction,
  deps: CompactConversationDeps<E>,
): Promise<Result<ChatSummary, CompactionError<E>>> {
  if (input.turns.length === 0) {
    return err({ kind: 'nothing-to-compact' });
  }
  const built = buildCompactionPrompt(input, deps.budget ?? defaultBudget);
  const output = await deps.model.runText({
    system: built.system,
    prompt: built.prompt,
    cwd: input.worktreePath,
    timeout: deps.timeout ?? Temporal.Duration.from({ minutes: 3 }),
    ...(deps.signal !== undefined && { signal: deps.signal }),
  });
  if (!output.ok) {
    return err({ kind: 'model', error: output.error });
  }
  const text = output.value.value.trim();
  const validated = validateCitations(text, parseCitations(text), {
    knownPaths: citablePathsFrom(input.files, input.worktreePaths),
    worktreePath: input.worktreePath,
  });
  return ok({
    content: validated.content,
    citations: validated.citations,
    dropped: validated.dropped,
    malformedCitations: validated.malformed,
    omittedTurns: built.omittedTurns,
  });
}
