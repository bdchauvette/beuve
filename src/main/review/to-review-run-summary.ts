import type { ReviewRunSummaryView } from '#contract/ipc-contract.ts';
import type { ReviewRun } from '#internal/review/agent-insight.ts';
import type { PreliminaryReview } from '#internal/review/run-preliminary-review.ts';

/** What one run adds when it has just finished, beyond what the store keeps. */
export interface FreshRunDetails {
  readonly review: PreliminaryReview;
  readonly fileCount: number;
  readonly pathPrefixes: readonly string[];
}

/** A stored run, or a just-finished one with its drop reasons and usage, as contract data. */
export function toReviewRunSummary(run: ReviewRun, fresh?: FreshRunDetails): ReviewRunSummaryView {
  const summary: ReviewRunSummaryView = {
    reviewRunId: run.id,
    sessionId: run.sessionId,
    headSha: run.headSha,
    scope: run.scope,
    model: run.model,
    insightCount: run.insightCount,
    droppedCount: run.droppedCount,
    createdAt: run.createdAt,
  };
  if (fresh === undefined) {
    return summary;
  }
  const { usage, dropped } = fresh.review;
  return {
    ...summary,
    dropped: { ...dropped },
    fileCount: fresh.fileCount,
    ...(fresh.pathPrefixes.length > 0 && { pathPrefixes: [...fresh.pathPrefixes] }),
    durationMs: usage.durationMs,
    ...(usage.costUsd !== undefined && { costUsd: usage.costUsd }),
  };
}
