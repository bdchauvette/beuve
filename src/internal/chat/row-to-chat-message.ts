import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type {
  ChatMessage,
  ChatMessageBase,
  ChatMention,
  ChatMessageId,
  ChatStoreError,
  Citation,
  CommitSha,
  SessionId,
} from './chat-message.ts';

type CorruptRow = Extract<ChatStoreError, { kind: 'corrupt-row' }>;

/** Validates a `chat_messages` row selected with its own column names. */
export function rowToChatMessage(
  row: Record<string, SQLOutputValue>,
): Result<ChatMessage, CorruptRow> {
  const corrupt = (reason: string): Result<ChatMessage, CorruptRow> =>
    err({ kind: 'corrupt-row', table: 'chat_messages', id: String(row['id']), reason });
  const {
    id,
    session_id,
    head_sha,
    role,
    content,
    citations,
    mentions,
    status,
    error_code,
    created_at,
  } = row;

  if (!isUuid(id) || !isUuid(session_id)) {
    return corrupt('id or session_id is not a UUID');
  }
  if (typeof head_sha !== 'string' || !commitSha.test(head_sha)) {
    return corrupt('head_sha is not a commit id');
  }
  if (typeof content !== 'string') {
    return corrupt('content is not text');
  }
  const parsedCitations = parseJsonList(citations, toCitation);
  if (parsedCitations === undefined) {
    return corrupt('citations is not a JSON array of citations');
  }
  const parsedMentions = parseJsonList(mentions, toMention);
  if (parsedMentions === undefined) {
    return corrupt('mentions is not a JSON array of mentions');
  }
  if (typeof created_at !== 'string' || !isoUtc.test(created_at)) {
    return corrupt('created_at is not an ISO-8601 UTC timestamp');
  }
  const base: ChatMessageBase = {
    id: id as ChatMessageId,
    sessionId: session_id as SessionId,
    headSha: head_sha as CommitSha,
    content,
    citations: parsedCitations,
    mentions: parsedMentions,
    createdAt: created_at,
  };
  if (role === 'user' || role === 'system-notice' || role === 'summary') {
    return status === 'complete' ? ok({ ...base, role }) : corrupt(`a ${role} is not complete`);
  }
  if (role !== 'assistant') {
    return corrupt('role is not user, assistant, system-notice or summary');
  }
  if (status === 'failed') {
    return typeof error_code === 'string' && error_code.trim() !== ''
      ? ok({ ...base, role, status, errorCode: error_code })
      : corrupt('a failed answer has no error code');
  }
  if (status === 'streaming' || status === 'complete' || status === 'cancelled') {
    return error_code === null
      ? ok({ ...base, role, status })
      : corrupt('error_code without failure');
  }
  return corrupt('status is not streaming, complete, failed or cancelled');
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;
const commitSha = /^(?:[\da-f]{40}|[\da-f]{64})$/u;
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function parseJsonList<T>(
  value: unknown,
  toItem: (item: unknown) => T | undefined,
): T[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(json)) {
    return undefined;
  }
  const items: T[] = [];
  for (const entry of json as unknown[]) {
    const item = toItem(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

function toCitation(item: unknown): Citation | undefined {
  if (typeof item !== 'object' || item === null) {
    return undefined;
  }
  const { path, startLine, endLine, side } = item as Record<string, unknown>;
  const isCitation =
    typeof path === 'string' &&
    path !== '' &&
    side === 'head' &&
    isLine(startLine) &&
    isLine(endLine) &&
    endLine >= startLine;
  return isCitation ? { path, startLine, endLine, side } : undefined;
}

function toMention(item: unknown): ChatMention | undefined {
  if (typeof item !== 'object' || item === null) {
    return undefined;
  }
  const { path, side, startLine, endLine, sha } = item as Record<string, unknown>;
  if (
    typeof path !== 'string' ||
    path === '' ||
    typeof sha !== 'string' ||
    !commitSha.test(sha) ||
    (side !== 'head' && side !== 'base')
  ) {
    return undefined;
  }
  if (startLine === undefined && endLine === undefined) {
    return { path, side, sha: sha as CommitSha };
  }
  return isLine(startLine) && isLine(endLine) && endLine >= startLine
    ? { path, side, startLine, endLine, sha: sha as CommitSha }
    : undefined;
}

function isLine(line: unknown): line is number {
  return Number.isSafeInteger(line) && Number(line) >= 1;
}
