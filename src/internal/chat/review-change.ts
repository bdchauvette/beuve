import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatError } from './ask-question.ts';
import { buildChatPrompt } from './build-chat-prompt.ts';
import type { ChatPromptBudget } from './build-chat-prompt.ts';
import type { Citation } from './chat-message.ts';
import type { ChatModelProgress } from './chat-model.ts';
import type { ChatQuestion } from './chat-question.ts';
import type { ChatFinding, ChatReview } from './chat-review.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';
import { findingOutputSchema } from './finding-output-schema.ts';
import type { ModelFinding } from './finding-output-schema.ts';
import type { ReviewModel } from './review-model.ts';
import { validateFindings } from './validate-findings.ts';
import { verifyFindings } from './verify-findings.ts';
import type { FindingVerdict } from './verify-findings.ts';

/** `E` is the model adapter's error type. */
export interface ReviewChangeDeps<E> {
  readonly model: ReviewModel<E>;
  /** Runs the verification pass (a cheaper setting of the same adapter); omit for `--no-verify`. */
  readonly verifier?: ReviewModel<E>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ReviewProgress) => void;
  readonly budget?: ChatPromptBudget;
  /** Defaults to 12. */
  readonly maxFindings?: number;
  /** Defaults to 0.3. */
  readonly minConfidence?: number;
  /** For both passes together; defaults to 10 minutes. */
  readonly timeoutMs?: number;
  /** Milliseconds since some epoch, for the shared deadline; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Coarse progress for the transcript's status line; never prompt or file content. */
export type ReviewProgress =
  | { readonly kind: 'reviewing'; readonly files: number }
  | { readonly kind: 'model'; readonly progress: ChatModelProgress }
  | { readonly kind: 'verifying'; readonly findings: number };

export interface ReviewedChange {
  /** Markdown naming every finding with a `[[path:start-end]]` citation, for later prompts. */
  readonly content: string;
  readonly citations: readonly Citation[];
  readonly review: ChatReview;
}

/** Below this much time left, the verification pass is not started. */
const minVerifyMs = 5000;

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
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 10 * 60 * 1000;
  const deadline = now() + timeoutMs;
  const maxFindings = deps.maxFindings ?? 12;
  const pathScope = input.task?.kind === 'review' ? input.task.pathScope : [];
  const task = { kind: 'review', pathScope, maxFindings } as const;
  const textFiles = input.files.filter((file) => !file.binary && file.status !== 'deleted');
  if (textFiles.length === 0) {
    return ok(assemble([], emptyDrops, pathScope, input.files.length, 'skipped'));
  }

  const built = buildChatPrompt({ ...input, task }, deps.budget ?? defaultChatPromptBudget);
  deps.onProgress?.({ kind: 'reviewing', files: input.files.length });
  const output = await deps.model.run({
    system: built.system,
    prompt: built.prompt,
    cwd: input.worktreePath,
    outputSchema: findingOutputSchema,
    timeoutMs,
    ...(deps.signal !== undefined && { signal: deps.signal }),
    onProgress: (progress) => deps.onProgress?.({ kind: 'model', progress }),
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
  const remaining = deadline - now();
  if (remaining < minVerifyMs) {
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
    },
    {
      model: deps.verifier,
      timeoutMs: remaining,
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
  return findings.map((finding) => ({ ...finding, check: 'unchecked' }));
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
    const isCited = citations.some(
      (citation) =>
        citation.path === finding.path &&
        citation.startLine === finding.startLine &&
        citation.endLine === finding.endLine,
    );
    if (!isCited) {
      citations.push({
        path: finding.path,
        startLine: finding.startLine,
        endLine: finding.endLine,
        side: 'head',
      });
    }
  }
  return { content: renderReviewMarkdown(review), citations, review };
}

function renderReviewMarkdown(review: ChatReview): string {
  const count = `${String(review.findings.length)} ${review.findings.length === 1 ? 'finding' : 'findings'}`;
  const unconfirmed =
    review.dropped.unconfirmed === 0
      ? ''
      : `, ${String(review.dropped.unconfirmed)} dropped as unconfirmed`;
  const header = `**Review** of ${String(review.fileCount)} ${review.fileCount === 1 ? 'file' : 'files'}: ${count}${unconfirmed}.`;
  const items = review.findings.map(
    (finding) =>
      `- **${finding.severity}, ${finding.category}** ${finding.title} ` +
      `[[${finding.path}:${String(finding.startLine)}-${String(finding.endLine)}]] ` +
      `(confidence ${finding.confidence.toFixed(2)}, ${finding.check}): ` +
      finding.body.replaceAll(/\s+/gu, ' '),
  );
  return [header, ...(items.length === 0 ? [] : ['', ...items])].join('\n');
}
