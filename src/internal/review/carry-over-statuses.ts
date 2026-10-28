import type { AgentInsight } from './agent-insight.ts';
import { isSameInsight } from './is-same-insight.ts';

/**
 * Gives each new insight the status the reviewer already chose for the same observation: the
 * first non-`pending` {@link isSameInsight} among `previous` (pass them newest first) wins.
 * Unmatched insights stay as they are.
 */
export function carryOverStatuses(
  insights: readonly AgentInsight[],
  previous: readonly AgentInsight[],
): AgentInsight[] {
  return insights.map((insight) => {
    if (insight.status !== 'pending') {
      return insight;
    }
    const decided = previous.find((old) => old.status !== 'pending' && isSameInsight(old, insight));
    return decided === undefined ? insight : { ...insight, status: decided.status };
  });
}
