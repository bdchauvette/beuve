import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { AgentInsight, AgentInsightId, ReviewRun, ReviewRunId } from './agent-insight.ts';
import { buildReviewPrompt } from './build-review-prompt.ts';
import type { PromptBudget, PromptReport } from './build-review-prompt.ts';
import { defaultPromptBudget } from './default-prompt-budget.ts';
import { normalizePathScope } from './normalize-path-scope.ts';
import { insightOutputSchema } from './insight-output-schema.ts';
import type { ModelInsight } from './insight-output-schema.ts';
import type { ReviewInput } from './review-input.ts';
import type { ModelError, ModelProgress, ReviewModel } from './review-model.ts';
import { validateInsights } from './validate-insights.ts';
import type { InsightDrops } from './validate-insights.ts';

export interface PreliminaryReviewDeps {
  readonly model: ReviewModel;
  readonly clock: () => Date;
  readonly ids: () => string;
  readonly budget?: PromptBudget;
  /** Defaults to 0.3. */
  readonly minConfidence?: number;
  /** Defaults to 10 minutes. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ModelProgress) => void;
}

export interface PreliminaryReview {
  /** Persist with `insertReviewRun(db, run, insights)`. */
  readonly run: ReviewRun;
  readonly insights: readonly AgentInsight[];
  readonly dropped: InsightDrops;
  readonly clamped: number;
  readonly prompt: PromptReport;
  readonly usage: {
    readonly turns: number | undefined;
    readonly costUsd: number | undefined;
    readonly durationMs: number;
    readonly deniedToolUses: number;
  };
}

/** The model name recorded for a run that had no reviewable text and never called a model. */
const noModel = 'none';

/**
 * One preliminary agentic review (spec 5B): builds the prompt, asks the model, validates its
 * insights against the diff and stamps them as pending insights of a new run. Pure apart from the
 * model port and the injected clock and ids. Scheduling, cancellation when the head moves, and
 * one run per (session, head, path scope) are main's job ({@link reviewRunKey}, `findReviewRun`).
 */
export async function runPreliminaryReview(
  input: ReviewInput,
  deps: PreliminaryReviewDeps,
): Promise<Result<PreliminaryReview, ModelError>> {
  const budget = deps.budget ?? defaultPromptBudget;
  const built = buildReviewPrompt(input, budget);
  const hasText = input.files.some((file) => !file.binary && file.status !== 'deleted');
  if (!hasText) {
    return ok(assemble(input, deps, built.report, noModel, [], emptyValidation, undefined));
  }

  const output = await deps.model.run({
    system: built.system,
    prompt: built.prompt,
    cwd: input.worktreePath,
    outputSchema: insightOutputSchema,
    timeoutMs: deps.timeoutMs ?? 10 * 60 * 1000,
    ...(deps.signal !== undefined && { signal: deps.signal }),
    ...(deps.onProgress !== undefined && { onProgress: deps.onProgress }),
  });
  if (!output.ok) {
    return err(output.error);
  }
  const validated = validateInsights(output.value.value.insights, input, {
    maxInsights: budget.maxInsights,
    minConfidence: deps.minConfidence ?? 0.3,
  });
  const model = output.value.model ?? 'unknown';
  return ok(
    assemble(input, deps, built.report, model, validated.insights, validated, output.value),
  );
}

const emptyValidation = {
  dropped: { unknownFile: 0, outsideDiff: 0, lowConfidence: 0, duplicate: 0, overLimit: 0 },
  clamped: 0,
};

function assemble(
  input: ReviewInput,
  deps: PreliminaryReviewDeps,
  prompt: PromptReport,
  model: string,
  kept: readonly ModelInsight[],
  validation: { readonly dropped: InsightDrops; readonly clamped: number },
  usage: PreliminaryReview['usage'] | undefined,
): PreliminaryReview {
  const createdAt = deps.clock().toISOString();
  const { scope } = input;
  const dropped = validation.dropped;
  const run: ReviewRun = {
    id: deps.ids() as ReviewRunId,
    sessionId: input.sessionId,
    scope: scope.kind,
    pathScope: normalizePathScope(input.pathScope ?? []),
    baseSha: scope.baseSha,
    headSha: scope.headSha,
    fromHeadSha: scope.kind === 'interdiff' ? scope.fromHeadSha : undefined,
    model,
    insightCount: kept.length,
    droppedCount:
      dropped.unknownFile +
      dropped.outsideDiff +
      dropped.lowConfidence +
      dropped.duplicate +
      dropped.overLimit,
    createdAt,
  };
  const insights = kept.map((insight): AgentInsight => ({
    id: deps.ids() as AgentInsightId,
    runId: run.id,
    sessionId: input.sessionId,
    headSha: scope.headSha,
    path: insight.path,
    side: 'head',
    lineStart: insight.lineStart,
    lineEnd: insight.lineEnd,
    severity: insight.severity,
    category: insight.category,
    title: insight.title,
    body: insight.body,
    confidence: insight.confidence,
    status: 'pending',
    model,
    createdAt,
  }));
  return {
    run,
    insights,
    dropped,
    clamped: validation.clamped,
    prompt,
    usage: {
      turns: usage?.turns,
      costUsd: usage?.costUsd,
      durationMs: usage?.durationMs ?? 0,
      deniedToolUses: usage?.deniedToolUses ?? 0,
    },
  };
}
