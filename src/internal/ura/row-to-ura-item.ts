import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import { isCommitSha } from '#x/git/is-commit-sha.ts';
import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import type {
  AgentInsightId,
  SessionId,
  UraAnchor,
  UraItem,
  UraItemId,
  UraOrigin,
  UraStatus,
  UraStoreError,
} from './ura-item.ts';
import { uraSeverities } from './ura-severities.ts';
import type { UraSeverity } from './ura-severities.ts';
import { validateUraItem } from './validate-ura-item.ts';

type CorruptRow = Extract<UraStoreError, { kind: 'corrupt-row' }>;
type Row = Record<string, SQLOutputValue>;

/**
 * Validates a `ura_items` row and maps it to an item, re-checking it with the same rules as the
 * constructors (including re-parsing the patch), so a row no build could have written is a
 * `corrupt-row` error rather than a cast.
 */
export function rowToUraItem(row: Row): Result<UraItem, CorruptRow> {
  const corrupt = (reason: string): Result<UraItem, CorruptRow> =>
    err({ kind: 'corrupt-row', table: 'ura_items', id: String(row['id']), reason });
  const { id, session_id, head_sha, severity, title, body, patch, created_at, updated_at } = row;
  if (!isUuid(id) || !isUuid(session_id)) {
    return corrupt('id or session_id is not a UUID');
  }
  if (!isCommitSha(head_sha)) {
    return corrupt('head_sha is not a commit id');
  }
  if (typeof severity !== 'string' || !(uraSeverities as readonly string[]).includes(severity)) {
    return corrupt('severity is unknown');
  }
  if (typeof title !== 'string' || typeof body !== 'string') {
    return corrupt('title or body is not text');
  }
  if (patch !== null && typeof patch !== 'string') {
    return corrupt('patch is not text');
  }
  if (!isIsoTimestamp(created_at) || !isIsoTimestamp(updated_at)) {
    return corrupt('created_at or updated_at is not an ISO-8601 UTC timestamp');
  }
  const anchor = toAnchor(row);
  const origin = toOrigin(row);
  const status = toStatus(row);
  if (typeof anchor === 'string' || typeof origin === 'string' || typeof status === 'string') {
    return corrupt([anchor, origin, status].filter((part) => typeof part === 'string').join('; '));
  }
  const item = validateUraItem({
    id: id as UraItemId,
    sessionId: session_id as SessionId,
    headSha: head_sha,
    anchor,
    severity: severity as UraSeverity,
    origin,
    title,
    body,
    suggestion: patch ?? undefined,
    status,
    createdAt: created_at,
    updatedAt: updated_at,
  });
  return item.ok ? item : corrupt(`${item.error.kind}: ${item.error.reason}`);
}

function toAnchor(row: Row): UraAnchor | string {
  const { anchor_kind, path, line_start, line_end } = row;
  switch (anchor_kind) {
    case 'change': {
      return { kind: 'change' };
    }
    case 'file': {
      return typeof path === 'string' ? { kind: 'file', path } : 'path is not text';
    }
    case 'lines': {
      return typeof path === 'string' && isInteger(line_start) && isInteger(line_end)
        ? { kind: 'lines', path, startLine: Number(line_start), endLine: Number(line_end) }
        : 'path, line_start or line_end is missing';
    }
    default: {
      return 'anchor_kind is unknown';
    }
  }
}

function toOrigin(row: Row): UraOrigin | string {
  const { origin_kind, insight_id, chat_message_id, impact_metric, impact_function } = row;
  const { impact_value, impact_threshold, impact_percentile } = row;
  switch (origin_kind) {
    case 'human': {
      return { kind: 'human' };
    }
    case 'agent-insight': {
      return isUuid(insight_id)
        ? { kind: 'agent-insight', insightId: insight_id as AgentInsightId }
        : 'insight_id is not a UUID';
    }
    case 'chat-answer': {
      return typeof chat_message_id === 'string'
        ? { kind: 'chat-answer', messageId: chat_message_id }
        : 'chat_message_id is not text';
    }
    case 'impact-finding': {
      return impact_metric === 'cognitive-complexity' &&
        typeof impact_function === 'string' &&
        typeof impact_value === 'number' &&
        typeof impact_threshold === 'number' &&
        typeof impact_percentile === 'number'
        ? {
            kind: 'impact-finding',
            metric: impact_metric,
            functionName: impact_function,
            value: impact_value,
            threshold: impact_threshold,
            percentile: impact_percentile,
          }
        : 'the ImpactGate columns are incomplete';
    }
    default: {
      return 'origin_kind is unknown';
    }
  }
}

function toStatus(row: Row): UraStatus | string {
  const { status, addressed_sha, addressed_by } = row;
  switch (status) {
    case 'staged':
    case 'withdrawn': {
      return { kind: status };
    }
    case 'addressed': {
      return isCommitSha(addressed_sha) && (addressed_by === 'reviewer' || addressed_by === 'agent')
        ? { kind: 'addressed', atSha: addressed_sha, by: addressed_by }
        : 'addressed_sha or addressed_by is invalid';
    }
    default: {
      return 'status is unknown';
    }
  }
}

function isInteger(value: unknown): value is number | bigint {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value));
}
