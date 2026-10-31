import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatError } from './ask-question.ts';
import { buildChatPrompt } from './build-chat-prompt.ts';
import type { ChatPromptBudget } from './build-chat-prompt.ts';
import type { Citation } from './chat-message.ts';
import type { ChatEffort, ChatModelProgress } from './chat-model.ts';
import { chatPromptBudgetFrom } from './chat-prompt-budget-from.ts';
import type { ChatQuestion } from './chat-question.ts';
import type { ChatFinding, ChatReview } from './chat-review.ts';
import { findingOutputSchema } from './finding-output-schema.ts';
import type { ModelFinding } from './finding-output-schema.ts';
import type { ReviewModel } from './review-model.ts';
import { validateFindings } from './validate-findings.ts';
import { verifyFindings } from './verify-findings.ts';
import type { FindingVerdict } from './verify-findings.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

/** `E` is the model adapter's error type. */
export interface ReviewChangeDeps<E> {
  readonly model: ReviewModel<E>;
  /** Runs the verification pass (a cheaper setting of the same adapter); omit for `--no-verify`. */
  readonly verifier?: ReviewModel<E>;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: (progress: ReviewProgress) => void;
  /** Defaults to {@link chatPromptBudgetFrom} the first pass's model. */
  readonly budget?: ChatPromptBudget;
  /** The first pass's effort (`/review --effort`); the model's own when omitted. */
  readonly effort?: ChatEffort;
  /** The verification pass's effort; defaults to `low` (ADR 0055). */
  readonly verifierEffort?: ChatEffort;
  /** Defaults to 12. */
  readonly maxFindings?: number;
  /** Defaults to 0.3. */
  readonly minConfidence?: number;
  /** For both passes together; defaults to 10 minutes. */
  readonly timeout?: Temporal.Duration;
}

/** Coarse progress for the transcript's status line; never prompt or file content. */
export type ReviewProgress =
  | { readonly kind: 'reviewing'; readonly files: number }
  /** What a pass's model is doing: the first `review` or the `verify` pass. */
  | {
      readonly kind: 'model';
      readonly pass: 'review' | 'verify';
      readonly progress: ChatModelProgress;
    }
  | { readonly kind: 'verifying'; readonly findings: number };

export interface ReviewedChange {
  readonly citations: readonly Citation[];
  readonly review: ChatReview;
}

/** Below this much time left, the verification pass is not started. */
const minVerify = Temporal.Duration.from({ seconds: 5 });

/**
 * `/review` as a chat request (ADR 0055): asks the model for findings through the structured
 * output, keeps only those on the reviewed diff's hunks (`validateFindings`), then, unless
 * `verifier` is omitted, asks it to check each finding against the code at its lines and drops
 * the refuted ones. Both passes share one time budget. A verification pass that fails leaves the
 * findings `unchecked` rather than failing the review; a cancellation fails it. Pure apart from
 * the model ports. `input.task` must be a review task.
 */
export async function reviewChange<E>(
  input: ChatQuestion,
  deps: ReviewChangeDeps<E>,
): Promise<Result<ReviewedChange, ChatError<E>>> {
  const timeout = deps.timeout ?? Temporal.Duration.from({ minutes: 10 });
  const stopwatch = new Stopwatch();
  const maxFindings = deps.maxFindings ?? 12;
  const pathScope = input.task?.kind === 'review' ? input.task.pathScope : [];
  const task = { kind: 'review', pathScope, maxFindings } as const;
  const textFiles = input.files.filter((file) => !file.binary && file.status !== 'deleted');
  if (textFiles.length === 0) {
    return ok(assemble([], emptyDrops, pathScope, input.files.length, 'skipped'));
  }

  const built = buildChatPrompt(
    { ...input, task },
    deps.budget ?? chatPromptBudgetFrom(deps.model.capabilities),
    { tools: deps.model.capabilities?.tools ?? true },
  );
  deps.onProgress?.({ kind: 'reviewing', files: input.files.length });
  const output = await deps.model.run({
    system: built.system,
    messages: built.messages,
    cwd: input.worktreePath,
    outputSchema: findingOutputSchema,
    timeout,
    ...(deps.signal !== undefined && { signal: deps.signal }),
    ...(deps.effort !== undefined && { effort: deps.effort }),
    onProgress: (progress) => {
      return deps.onProgress?.({ kind: 'model', pass: 'review', progress });
    },
  });
  if (!output.ok) {
    return err({ kind: 'model', error: output.error });
  }
  const validated = validateFindings(output.value.value.findings, input, {
    maxFindings,
    minConfidence: deps.minConfidence ?? 0.3,
  });
  const drops = { ...validated.dropped, unconfirmed: 0 };
  if (deps.verifier === undefined || validated.findings.length === 0) {
    return ok(
      assemble(unchecked(validated.findings), drops, pathScope, input.files.length, 'skipped'),
    );
  }
  const remaining = timeout.subtract(stopwatch.elapsed());
  if (Temporal.Duration.compare(remaining, minVerify) < 0) {
    return ok(
      assemble(unchecked(validated.findings), drops, pathScope, input.files.length, 'failed'),
    );
  }

  deps.onProgress?.({ kind: 'verifying', findings: validated.findings.length });
  const verdicts = await verifyFindings(
    {
      findings: validated.findings,
      baseSha: input.baseSha,
      headSha: input.headSha,
      worktreePath: input.worktreePath,
      files: input.files,
    },
    {
      model: deps.verifier,
      effort: deps.verifierEffort ?? 'low',
      timeout: remaining,
      onProgress: (progress) => {
        return deps.onProgress?.({ kind: 'model', pass: 'verify', progress });
      },
      ...(deps.signal !== undefined && { signal: deps.signal }),
    },
  );
  if (!verdicts.ok) {
    return deps.signal?.aborted === true
      ? err({ kind: 'model', error: verdicts.error })
      : ok(assemble(unchecked(validated.findings), drops, pathScope, input.files.length, 'failed'));
  }
  const kept = applyVerdicts(validated.findings, verdicts.value);
  return ok(
    assemble(
      kept,
      { ...drops, unconfirmed: validated.findings.length - kept.length },
      pathScope,
      input.files.length,
      'verified',
    ),
  );
}

const emptyDrops: ChatReview['dropped'] = {
  unknownFile: 0,
  outsideDiff: 0,
  lowConfidence: 0,
  duplicate: 0,
  overLimit: 0,
  unconfirmed: 0,
};

function unchecked(findings: readonly ModelFinding[]): ChatFinding[] {
  return findings.map((finding) => {
    return { ...finding, check: 'unchecked' };
  });
}

function applyVerdicts(
  findings: readonly ModelFinding[],
  verdicts: readonly FindingVerdict[],
): ChatFinding[] {
  return findings.flatMap((finding, index): ChatFinding[] => {
    const verdict = verdicts[index] ?? 'unsure';
    if (verdict === 'refuted') {
      return [];
    }
    return [{ ...finding, check: verdict === 'confirmed' ? 'confirmed' : 'unconfirmed' }];
  });
}

function assemble(
  findings: readonly ChatFinding[],
  dropped: ChatReview['dropped'],
  pathScope: readonly string[],
  fileCount: number,
  verification: ChatReview['verification'],
): ReviewedChange {
  const review: ChatReview = { findings, dropped, pathScope, fileCount, verification };
  const citations: Citation[] = [];
  for (const finding of findings) {
    const isCited = citations.some((citation) => {
      return (
        citation.path === finding.path &&
        citation.startLine === finding.startLine &&
        citation.endLine === finding.endLine
      );
    });
    if (!isCited) {
      citations.push({
        path: finding.path,
        startLine: finding.startLine,
        endLine: finding.endLine,
        side: 'head',
      });
    }
  }
  return { citations, review };
}
