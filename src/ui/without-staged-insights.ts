import type { ReviewInsight } from './merge-review-insights.ts';

/**
 * The insights not yet staged. `staged` holds the `messageId:index` of each staged `/review`
 * finding; an insight counts as staged when any answer that made it is in there, so a rerun
 * never offers a finding the reviewer already staged (the dock's own marker shows it, ADR 0061).
 */
export function withoutStagedInsights(
  insights: readonly ReviewInsight[],
  staged: ReadonlySet<string>,
): ReviewInsight[] {
  return insights.filter((insight) => {
    return insight.sources.every((source) => !staged.has(source));
  });
}
