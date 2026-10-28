import type { DatabaseSync } from 'node:sqlite';

import type { AgentInsight, ReviewRun } from './agent-insight.ts';
import { carryOverStatuses } from './carry-over-statuses.ts';
import { selectHeadInsights } from './select-head-insights.ts';

/**
 * `insights` with the status the reviewer already gave a matching insight stored at the same head,
 * in any run (see {@link carryOverStatuses}). If a stored row is corrupt nothing is carried
 * over; the new insights are valid on their own.
 */
export function carryOverStoredStatuses(
  db: DatabaseSync,
  run: Pick<ReviewRun, 'sessionId' | 'headSha'>,
  insights: readonly AgentInsight[],
): AgentInsight[] {
  const previous = selectHeadInsights(db, run.sessionId, run.headSha);
  return previous.ok ? carryOverStatuses(insights, previous.value) : [...insights];
}
