import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { buildChatPrompt } from './build-chat-prompt.ts';
import type { ChatPromptBudget, ChatPromptReport } from './build-chat-prompt.ts';
import type { Citation } from './chat-message.ts';
import type { ChatDelta, ChatModel, ChatModelProgress } from './chat-model.ts';
import type { ChatQuestion } from './chat-question.ts';
import { chatPromptBudgetFrom } from './chat-prompt-budget-from.ts';
import { parseCitations } from './parse-citations.ts';
import { citablePathsFrom } from './citable-paths-from.ts';
import type { AnswerPiece } from './note-proposal.ts';
import { parseNoteProposals } from './parse-note-proposals.ts';
import type { ProposalSegment } from './parse-note-proposals.ts';
import { validateCitations } from './validate-citations.ts';
import type { CitationScope, DroppedCitation } from './validate-citations.ts';
import { validateNoteProposals } from './validate-note-proposals.ts';

/** `E` is the model adapter's error type. */
export interface AskQuestionDeps<E> {
  readonly model: ChatModel<E>;
  readonly signal?: AbortSignal | undefined;
  /** The answer as it streams, when the adapter streams. */
  readonly onDelta?: (delta: ChatDelta) => void;
  readonly onProgress?: (progress: ChatModelProgress) => void;
  /** Defaults to {@link chatPromptBudgetFrom} the model's capabilities. */
  readonly budget?: ChatPromptBudget;
  /** Defaults to 5 minutes. */
  readonly timeout?: Temporal.Duration;
}

export interface ChatAnswer {
  /**
   * Markdown whose only citation markers are `citations` (see `validateCitations`): the text
   * pieces, joined by blank lines.
   */
  readonly answer: string;
  /**
   * The answer in order: its text, with each proposed review note in its place, kept or dropped
   * (ADR 0132). One text piece, or none for an empty answer, when the question offered no notes.
   */
  readonly pieces: readonly AnswerPiece[];
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
 * prompt, sized to the model's context window and worded for whether it has tools (ADR 0070),
 * asks the model in the head worktree, and validates the answer's citations against the
 * diff's and the worktree's files. Pure apart from the model port. Persisting the transcript,
 * one question in flight per session and cancellation are main's job.
 */
export async function askQuestion<E>(
  input: ChatQuestion,
  deps: AskQuestionDeps<E>,
): Promise<Result<ChatAnswer, ChatError<E>>> {
  const budget = deps.budget ?? chatPromptBudgetFrom(deps.model.capabilities);
  const question = input.question.trim();
  if (question === '' && input.task === undefined) {
    return err({ kind: 'empty-question' });
  }
  if (input.task === undefined && question.length > budget.maxQuestionChars) {
    return err({ kind: 'question-too-long', maxChars: budget.maxQuestionChars });
  }
  const built = buildChatPrompt(input, budget, {
    tools: deps.model.capabilities?.tools ?? true,
  });
  const output = await deps.model.runText({
    system: built.system,
    messages: built.messages,
    cwd: input.worktreePath,
    timeout: deps.timeout ?? Temporal.Duration.from({ minutes: 5 }),
    ...(deps.signal !== undefined && { signal: deps.signal }),
    ...(deps.onProgress !== undefined && { onProgress: deps.onProgress }),
    ...(deps.onDelta !== undefined && { onText: deps.onDelta }),
  });
  if (!output.ok) {
    return err({ kind: 'model', error: output.error });
  }
  const scope = {
    knownPaths: citablePathsFrom(input.files, input.worktreePaths),
    worktreePath: input.worktreePath,
  };
  const validated = validatedPieces(output.value.value.trim(), { input, scope });
  const { model, turns, costUsd, duration, deniedToolUses } = output.value;
  return ok({
    ...validated,
    prompt: built.report,
    usage: { model, turns, costUsd, duration, deniedToolUses },
  });
}

/** What {@link validatedPieces} checks an answer against. */
interface PieceScope {
  readonly input: ChatQuestion;
  readonly scope: CitationScope;
}

type ValidatedPieces = Pick<
  ChatAnswer,
  'answer' | 'pieces' | 'citations' | 'dropped' | 'malformedCitations'
>;

/**
 * The answer split at its proposed notes when the question offered them (ADR 0132), each note
 * checked against the diff, and the citations of each text piece checked (ADR 0031): kept ones
 * deduplicated across pieces in order of first appearance.
 */
function validatedPieces(answer: string, { input, scope }: PieceScope): ValidatedPieces {
  let segments: ProposalSegment[] = [{ kind: 'text', text: answer }];
  if (input.proposals !== undefined) {
    segments = parseNoteProposals(answer);
  }
  const raw = validateNoteProposals(segments, input, input.proposals ?? noProposals);
  const pieces: AnswerPiece[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  const dropped: DroppedCitation[] = [];
  let malformed = 0;
  for (const piece of raw) {
    if (piece.kind !== 'text') {
      pieces.push(piece);
      continue;
    }
    const text = piece.text.trim();
    if (text === '') {
      continue;
    }
    const checked = validateCitations(text, parseCitations(text), scope);
    pieces.push({ kind: 'text', text: checked.content });
    dropped.push(...checked.dropped);
    malformed += checked.malformed;
    for (const citation of checked.citations) {
      const key = `${citation.path}:${String(citation.startLine)}-${String(citation.endLine)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      citations.push(citation);
    }
  }
  const text = pieces.flatMap((piece) => {
    if (piece.kind === 'text') {
      return piece.text;
    }
    return [];
  });
  return {
    answer: text.join('\n\n'),
    pieces,
    citations,
    dropped,
    malformedCitations: malformed,
  };
}

const noProposals = { labels: [], maxProposals: 0 };
