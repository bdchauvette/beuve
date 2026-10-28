import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { AgentInsight, CommitSha, ReviewStoreError, SessionId } from './agent-insight.ts';
import { rowToAgentInsight } from './row-to-agent-insight.ts';

/** A session's insights for one head, every status, ordered by path and line. */
export function listAgentInsights(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: CommitSha,
): Result<AgentInsight[], Extract<ReviewStoreError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare(
      `SELECT i.*, r.model AS model
         FROM agent_insights i JOIN review_runs r ON r.id = i.run_id
        WHERE i.session_id = ? AND i.head_sha = ?
        ORDER BY i.path, i.line_start, i.line_end, i.rowid;`,
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
