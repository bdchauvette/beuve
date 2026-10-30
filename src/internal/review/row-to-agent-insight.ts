import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  AgentInsight,
  AgentInsightId,
  ReviewRunId,
  ReviewStoreError,
  SessionId,
} from './agent-insight.ts';
import { insightCategories } from './insight-categories.ts';
import type { InsightCategory } from './insight-categories.ts';
import { insightSeverities } from './insight-severities.ts';
import type { InsightSeverity } from './insight-severities.ts';
import { insightStatuses } from './insight-statuses.ts';
import type { InsightStatus } from './insight-statuses.ts';
import { isCommitSha } from './is-commit-sha.ts';
import { isIsoTimestamp } from './is-iso-timestamp.ts';
import { isUuid } from './is-uuid.ts';

type CorruptRow = Extract<ReviewStoreError, { kind: 'corrupt-row' }>;

/** Validates an `agent_insights` row joined with its run's `model`. */
export function rowToAgentInsight(
  row: Record<string, SQLOutputValue>,
): Result<AgentInsight, CorruptRow> {
  const corrupt = (reason: string): Result<AgentInsight, CorruptRow> =>
    err({ kind: 'corrupt-row', table: 'agent_insights', id: String(row['id']), reason });
  const { id, run_id, session_id, head_sha, path, line_start, line_end } = row;
  const { severity, category, title, body, confidence, status, model, created_at } = row;

  if (!isUuid(id) || !isUuid(run_id) || !isUuid(session_id)) {
    return corrupt('id, run_id or session_id is not a UUID');
  }
  if (!isCommitSha(head_sha)) {
    return corrupt('head_sha is not a commit id');
  }
  if (typeof path !== 'string' || path === '') {
    return corrupt('path is empty');
  }
  if (!isLine(line_start) || !isLine(line_end) || line_end < line_start) {
    return corrupt('line_start and line_end are not an ordered line range');
  }
  if (!isOneOf(severity, insightSeverities) || !isOneOf(category, insightCategories)) {
    return corrupt('severity or category is unknown');
  }
  if (!isOneOf(status, insightStatuses)) {
    return corrupt('status is unknown');
  }
  if (typeof title !== 'string' || typeof body !== 'string' || typeof model !== 'string') {
    return corrupt('title, body or model is not text');
  }
  if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
    return corrupt('confidence is not between 0 and 1');
  }
  if (!isIsoTimestamp(created_at)) {
    return corrupt('created_at is not an ISO-8601 UTC timestamp');
  }
  return ok({
    id: id as AgentInsightId,
    runId: run_id as ReviewRunId,
    sessionId: session_id as SessionId,
    headSha: head_sha,
    path,
    side: 'head',
    lineStart: Number(line_start),
    lineEnd: Number(line_end),
    severity: severity as InsightSeverity,
    category: category as InsightCategory,
    title,
    body,
    confidence,
    status: status as InsightStatus,
    model,
    createdAt: created_at,
  });
}

function isLine(value: unknown): value is number | bigint {
  return (typeof value === 'number' || typeof value === 'bigint') && value >= 1;
}

function isOneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value);
}
