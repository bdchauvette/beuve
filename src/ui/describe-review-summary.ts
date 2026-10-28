import type { ReviewDropsView, ReviewRunSummaryView } from '#contract/ipc-contract.ts';

const dropLabels: Readonly<Record<keyof ReviewDropsView, string>> = {
  outsideDiff: 'out of diff',
  unknownFile: 'unknown file',
  lowConfidence: 'low confidence',
  duplicate: 'duplicate',
  overLimit: 'over the limit',
};

/**
 * One line for the chat transcript: "4 insights, 2 dropped (out of diff)", or with several
 * reasons "4 insights, 3 dropped (2 out of diff, 1 low confidence)". Stored runs keep only the
 * total, so their drops have no reasons.
 */
export function describeReviewSummary(
  summary: Pick<ReviewRunSummaryView, 'insightCount' | 'droppedCount' | 'dropped'>,
): string {
  const insights = `${String(summary.insightCount)} ${summary.insightCount === 1 ? 'insight' : 'insights'}`;
  if (summary.droppedCount === 0) {
    return insights;
  }
  const { dropped } = summary;
  const reasons = (Object.keys(dropLabels) as (keyof ReviewDropsView)[])
    .map((reason) => ({ label: dropLabels[reason], count: dropped?.[reason] ?? 0 }))
    .filter(({ count }) => count > 0);
  const [only] = reasons;
  const detail =
    reasons.length === 0
      ? ''
      : only !== undefined && reasons.length === 1
        ? ` (${only.label})`
        : ` (${reasons.map(({ label, count }) => `${String(count)} ${label}`).join(', ')})`;
  return `${insights}, ${String(summary.droppedCount)} dropped${detail}`;
}
