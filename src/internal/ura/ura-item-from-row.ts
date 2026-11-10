import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import { isCommitSha } from '#git/is-commit-sha.ts';
import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import type {
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
export function uraItemFromRow(row: Row): Result<UraItem, CorruptRow> {
  const corrupt = (reason: string): Result<UraItem, CorruptRow> => {
    return err({ kind: 'corrupt-row', table: 'ura_items', id: String(row['id']), reason });
  };
  const { id, session_id, head_sha, severity, blocking, title, body, patch } = row;
  const { created_at, updated_at } = row;
  if (!isUuid(id) || !isUuid(session_id)) {
    return corrupt('id or session_id is not a UUID');
  }
  if (!isCommitSha(head_sha)) {
    return corrupt('head_sha is not a commit id');
  }
  if (typeof severity !== 'string' || !(uraSeverities as readonly string[]).includes(severity)) {
    return corrupt('severity is unknown');
  }
  if (blocking !== 0 && blocking !== 1) {
    return corrupt('blocking is not 0 or 1');
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
  const anchor = anchorFrom(row);
  const origin = originFrom(row);
  const status = statusFrom(row);
  if (typeof anchor === 'string' || typeof origin === 'string' || typeof status === 'string') {
    return corrupt([anchor, origin, status].filter((part) => typeof part === 'string').join('; '));
  }
  const item = validateUraItem({
    id: id as UraItemId,
    sessionId: session_id as SessionId,
    headSha: head_sha,
    anchor,
    severity: severity as UraSeverity,
    blocking: blocking === 1,
    origin,
    title,
    body,
    suggestion: patch ?? undefined,
    status,
    createdAt: created_at,
    updatedAt: updated_at,
  });
  if (item.ok) {
    return item;
  }
  return corrupt(`${item.error.kind}: ${item.error.reason}`);
}

function anchorFrom(row: Row): UraAnchor | string {
  const { anchor_kind, path, line_start, line_end } = row;
  switch (anchor_kind) {
    case 'change': {
      return { kind: 'change' };
    }
    case 'file': {
      if (typeof path === 'string') {
        return { kind: 'file', path };
      }
      return 'path is not text';
    }
    case 'lines': {
      if (typeof path === 'string' && isInteger(line_start) && isInteger(line_end)) {
        return { kind: 'lines', path, startLine: Number(line_start), endLine: Number(line_end) };
      }
      return 'path, line_start or line_end is missing';
    }
    default: {
      return 'anchor_kind is unknown';
    }
  }
}

function originFrom(row: Row): UraOrigin | string {
  const { origin_kind, chat_message_id, chat_finding, chat_proposal } = row;
  switch (origin_kind) {
    case 'human': {
      return { kind: 'human' };
    }
    case 'chat-answer': {
      if (typeof chat_message_id !== 'string') {
        return 'chat_message_id is not text';
      }
      if (chat_finding !== null && chat_proposal !== null) {
        return 'chat_finding and chat_proposal are both set';
      }
      const answer = { kind: 'chat-answer', messageId: chat_message_id } as const;
      if (chat_finding !== null) {
        if (isIndex(chat_finding)) {
          return { ...answer, finding: Number(chat_finding) };
        }
        return 'chat_finding is not a finding index';
      }
      if (chat_proposal !== null) {
        if (isIndex(chat_proposal)) {
          return { ...answer, proposal: Number(chat_proposal) };
        }
        return 'chat_proposal is not a proposal index';
      }
      return answer;
    }
    default: {
      return 'origin_kind is unknown';
    }
  }
}

function statusFrom(row: Row): UraStatus | string {
  const { status, addressed_sha, addressed_by } = row;
  switch (status) {
    case 'staged':
    case 'withdrawn': {
      return { kind: status };
    }
    case 'addressed': {
      if (isCommitSha(addressed_sha) && (addressed_by === 'reviewer' || addressed_by === 'agent')) {
        return { kind: 'addressed', atSha: addressed_sha, by: addressed_by };
      }
      return 'addressed_sha or addressed_by is invalid';
    }
    default: {
      return 'status is unknown';
    }
  }
}

function isInteger(value: unknown): value is number | bigint {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isIndex(value: unknown): boolean {
  return isInteger(value) && Number(value) >= 0;
}
