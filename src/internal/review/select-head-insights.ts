import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AgentInsight, CommitSha, ReviewStoreError, SessionId } from './agent-insight.ts';
import { rowToAgentInsight } from './row-to-agent-insight.ts';

/**
 * Every stored insight of a session at one head, from all its runs and in every status, newest
 * first (by creation time, then insertion). Unlike `listAgentInsights` it keeps duplicates.
 */
export function selectHeadInsights(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: CommitSha,
): Result<AgentInsight[], Extract<ReviewStoreError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare(
      `SELECT i.*, r.model AS model
         FROM agent_insights i JOIN review_runs r ON r.id = i.run_id
        WHERE i.session_id = ? AND i.head_sha = ?
        ORDER BY i.created_at DESC, i.rowid DESC;`,
    )
    .all(sessionId, headSha);
  const insights: AgentInsight[] = [];
  for (const row of rows) {
    const insight = rowToAgentInsight(row);
    if (!insight.ok) {
      return insight;
    }
    insights.push(insight.value);
  }
  return ok(insights);
}
