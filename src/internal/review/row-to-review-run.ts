import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ReviewRun, ReviewRunId, ReviewStoreError, SessionId } from './agent-insight.ts';
import { isCommitSha } from '#x/git/is-commit-sha.ts';
import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import { parsePathScope } from './parse-path-scope.ts';

type CorruptRow = Extract<ReviewStoreError, { kind: 'corrupt-row' }>;

/** Validates a `review_runs` row selected with its own column names. */
export function rowToReviewRun(row: Record<string, SQLOutputValue>): Result<ReviewRun, CorruptRow> {
  const corrupt = (reason: string): Result<ReviewRun, CorruptRow> =>
    err({ kind: 'corrupt-row', table: 'review_runs', id: String(row['id']), reason });
  const { id, session_id, scope, path_scope, base_sha, head_sha, from_head_sha, model } = row;
  const { insight_count, dropped_count, created_at } = row;

  if (!isUuid(id) || !isUuid(session_id)) {
    return corrupt('id or session_id is not a UUID');
  }
  if (scope !== 'full' && scope !== 'interdiff') {
    return corrupt('scope is not full or interdiff');
  }
  const pathScope = parsePathScope(path_scope);
  if (pathScope === undefined) {
    return corrupt('path_scope is not a JSON array of strings');
  }
  if (!isCommitSha(base_sha) || !isCommitSha(head_sha)) {
    return corrupt('base_sha or head_sha is not a commit id');
  }
  const fromHeadSha = from_head_sha ?? undefined;
  if (fromHeadSha !== undefined && !isCommitSha(fromHeadSha)) {
    return corrupt('from_head_sha is not a commit id');
  }
  if (typeof model !== 'string' || model.trim() === '') {
    return corrupt('model is empty');
  }
  if (!isCount(insight_count) || !isCount(dropped_count)) {
    return corrupt('insight_count or dropped_count is not a count');
  }
  if (!isIsoTimestamp(created_at)) {
    return corrupt('created_at is not an ISO-8601 UTC timestamp');
  }
  return ok({
    id: id as ReviewRunId,
    sessionId: session_id as SessionId,
    scope,
    pathScope,
    baseSha: base_sha,
    headSha: head_sha,
    fromHeadSha,
    model,
    insightCount: Number(insight_count),
    droppedCount: Number(dropped_count),
    createdAt: created_at,
  });
}

function isCount(value: unknown): value is number | bigint {
  return (typeof value === 'number' || typeof value === 'bigint') && value >= 0;
}
