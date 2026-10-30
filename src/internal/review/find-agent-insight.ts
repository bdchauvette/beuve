import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { AgentInsight, AgentInsightId, ReviewStoreError } from './agent-insight.ts';
import { rowToAgentInsight } from './row-to-agent-insight.ts';

/** One insight by id, whatever its status, with its run's model. */
export function findAgentInsight(
  db: DatabaseSync,
  id: AgentInsightId,
): Result<AgentInsight, Extract<ReviewStoreError, { kind: 'insight-not-found' | 'corrupt-row' }>> {
  const row = db
    .prepare(
      `SELECT i.*, r.model AS model
         FROM agent_insights i JOIN review_runs r ON r.id = i.run_id
        WHERE i.id = ?;`,
    )
    .get(id);
  return row === undefined ? err({ kind: 'insight-not-found', id }) : rowToAgentInsight(row);
}
