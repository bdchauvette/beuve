import type { AgentInsight } from './agent-insight.ts';
import { isSameInsight } from './is-same-insight.ts';

/**
 * Collapses insights that {@link isSameInsight} and have the same line range into the first of
 * them. Pass them newest first, so the newest run's copy (and its status) is the one kept; the
 * order of the survivors is unchanged.
 */
export function dedupeInsights(insights: readonly AgentInsight[]): AgentInsight[] {
  const kept: AgentInsight[] = [];
  for (const insight of insights) {
    const isDuplicate = kept.some(
      (other) =>
        other.lineStart === insight.lineStart &&
        other.lineEnd === insight.lineEnd &&
        isSameInsight(other, insight),
    );
    if (!isDuplicate) {
      kept.push(insight);
    }
  }
  return kept;
}
