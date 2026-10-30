import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AgentInsightId, ReviewStoreError } from './agent-insight.ts';
import type { InsightStatus } from './insight-statuses.ts';

/** Promotes (`y`), dismisses (`d`) or restores an insight. */
export function setAgentInsightStatus(
  db: DatabaseSync,
  id: AgentInsightId,
  status: InsightStatus,
): Result<void, Extract<ReviewStoreError, { kind: 'insight-not-found' }>> {
  const { changes } = db
    .prepare('UPDATE agent_insights SET status = ? WHERE id = ?;')
    .run(status, id);
  return Number(changes) === 0 ? err({ kind: 'insight-not-found', id }) : ok(undefined);
}
