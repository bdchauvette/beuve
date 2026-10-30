import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AgentInsight, CommitSha, ReviewStoreError, SessionId } from './agent-insight.ts';
import { dedupeInsights } from './dedupe-insights.ts';
import { selectHeadInsights } from './select-head-insights.ts';

/**
 * A session's insights for one head, every status, from all of the head's runs (ADR 0024). The
 * same observation found by overlapping runs appears once, as the newest run found it; the result
 * is ordered by path and line.
 */
export function listAgentInsights(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: CommitSha,
): Result<AgentInsight[], Extract<ReviewStoreError, { kind: 'corrupt-row' }>> {
  const all = selectHeadInsights(db, sessionId, headSha);
  if (!all.ok) {
    return all;
  }
  const sorted = dedupeInsights(all.value).toSorted(
    (a, b) => compareText(a.path, b.path) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd,
  );
  return ok(sorted);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
