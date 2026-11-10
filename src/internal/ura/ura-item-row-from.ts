import type { SQLInputValue } from 'node:sqlite';

import type { UraItem } from './ura-item.ts';

/**
 * An item's columns (all but `position`) as named parameters for `node:sqlite`. Columns that are
 * NULL for this item's anchor, origin or status are left out: SQLite binds unset parameters as
 * NULL.
 */
export function uraItemRowFrom(item: UraItem): Record<string, SQLInputValue> {
  return {
    id: item.id,
    session_id: item.sessionId,
    head_sha: item.headSha,
    ...anchorColumns(item.anchor),
    severity: item.severity,
    blocking: Number(item.blocking),
    ...originColumns(item.origin),
    title: item.title,
    body: item.body,
    ...(item.suggestion !== undefined && { patch: item.suggestion.text }),
    status: item.status.kind,
    ...(item.status.kind === 'addressed' && {
      addressed_sha: item.status.atSha,
      addressed_by: item.status.by,
    }),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function anchorColumns(anchor: UraItem['anchor']): Record<string, SQLInputValue> {
  switch (anchor.kind) {
    case 'lines': {
      return {
        anchor_kind: anchor.kind,
        path: anchor.path,
        line_start: anchor.startLine,
        line_end: anchor.endLine,
      };
    }
    case 'file': {
      return { anchor_kind: anchor.kind, path: anchor.path };
    }
    case 'change': {
      return { anchor_kind: anchor.kind };
    }
  }
}

function originColumns(origin: UraItem['origin']): Record<string, SQLInputValue> {
  switch (origin.kind) {
    case 'human': {
      return { origin_kind: origin.kind };
    }
    case 'chat-answer': {
      return {
        origin_kind: origin.kind,
        chat_message_id: origin.messageId,
        ...(origin.finding !== undefined && { chat_finding: origin.finding }),
      };
    }
  }
}
