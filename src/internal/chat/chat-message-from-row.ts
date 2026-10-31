import type { SQLOutputValue } from 'node:sqlite';

import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  AnswerKind,
  ChatMessage,
  ChatMessageBase,
  ChatMention,
  ChatMessageId,
  ChatPart,
  ChatStatus,
  ChatStoreError,
  Citation,
  CommitSha,
  SessionId,
} from './chat-message.ts';
import type { ChatReview } from './chat-review.ts';
import { findingCategories } from './finding-categories.ts';
import { findingSeverities } from './finding-severities.ts';

type CorruptRow = Extract<ChatStoreError, { kind: 'corrupt-row' }>;

/** Validates a `chat_messages` row selected with its own column names. */
export function chatMessageFromRow(
  row: Record<string, SQLOutputValue>,
): Result<ChatMessage, CorruptRow> {
  const corrupt = (reason: string): Result<ChatMessage, CorruptRow> => {
    return err({ kind: 'corrupt-row', table: 'chat_messages', id: String(row['id']), reason });
  };
  const { id, session_id, head_sha, role, parts, citations, status, kind, review, created_at } =
    row;

  if (!isUuid(id) || !isUuid(session_id)) {
    return corrupt('id or session_id is not a UUID');
  }
  if (typeof head_sha !== 'string' || !commitSha.test(head_sha)) {
    return corrupt('head_sha is not a commit id');
  }
  const parsedParts = parseParts(parts);
  if (parsedParts === undefined) {
    return corrupt('parts is not a JSON array of parts with distinct ids');
  }
  const parsedCitations = parseJsonList(citations, citationFrom);
  if (parsedCitations === undefined) {
    return corrupt('citations is not a JSON array of citations');
  }
  if (typeof created_at !== 'string' || !isoUtc.test(created_at)) {
    return corrupt('created_at is not an ISO-8601 UTC timestamp');
  }
  const base: ChatMessageBase = {
    id: id as ChatMessageId,
    sessionId: session_id as SessionId,
    headSha: head_sha as CommitSha,
    parts: parsedParts,
    citations: parsedCitations,
    createdAt: created_at,
  };
  if (role === 'user' || role === 'system-notice' || role === 'summary') {
    const allowed = role === 'user' ? questionPartKinds : textPartKinds;
    if (parsedParts.some((part) => !allowed.has(part.kind))) {
      return corrupt(`a ${role} has a part it can't have`);
    }
    return status === 'done' ? ok({ ...base, role }) : corrupt(`a ${role} is not done`);
  }
  if (role !== 'assistant') {
    return corrupt('role is not user, assistant, system-notice or summary');
  }
  if (!isAnswerKind(kind)) {
    return corrupt('kind is not answer, review or abstract');
  }
  if (!isStatus(status)) {
    return corrupt('status is not queued, submitted, streaming, done, error or cancelled');
  }
  if (parsedParts.some((part) => part.kind === 'mention')) {
    return corrupt('an answer has a mention part');
  }
  if ((status === 'error') !== parsedParts.some((part) => part.kind === 'error')) {
    return corrupt('an error part without an error status, or the other way round');
  }
  const parsedReview = parseReview(review);
  if (parsedReview === 'corrupt') {
    return corrupt('review is not a stored review');
  }
  const findings = parsedReview?.findings.length ?? 0;
  if (parsedParts.some((part) => part.kind === 'finding' && part.finding >= findings)) {
    return corrupt('a finding part names no finding of the review');
  }
  return ok({
    ...base,
    role: 'assistant',
    kind,
    status,
    ...(parsedReview !== undefined && { review: parsedReview }),
  });
}

const questionPartKinds: ReadonlySet<ChatPart['kind']> = new Set(['text', 'mention']);
const textPartKinds: ReadonlySet<ChatPart['kind']> = new Set(['text']);

const statuses: readonly unknown[] = [
  'queued',
  'submitted',
  'streaming',
  'done',
  'error',
  'cancelled',
] satisfies ChatStatus[];

function isStatus(value: unknown): value is ChatStatus {
  return statuses.includes(value);
}

const line = z.int().min(1);
const count = z.int().min(0);
const text = z.string().min(1);
const confidence = z.number().min(0).max(1);
const severity = z.enum(findingSeverities);
const category = z.enum(findingCategories);
const check = z.enum(['confirmed', 'unconfirmed', 'unchecked']);
const verification = z.enum(['verified', 'skipped', 'failed']);

const storedFinding = z.object({
  path: text,
  startLine: line,
  endLine: line,
  severity,
  category,
  title: text,
  body: z.string(),
  confidence,
  check,
});

const storedDrops = z.object({
  unknownFile: count,
  outsideDiff: count,
  lowConfidence: count,
  duplicate: count,
  overLimit: count,
  unconfirmed: count,
});

const storedReview = z.object({
  findings: z.array(storedFinding),
  dropped: storedDrops,
  pathScope: z.array(z.string()),
  fileCount: count,
  verification,
  reusedFrom: z.string().optional(),
});

const partId = z.string().regex(/^p[1-9]\d{0,5}$/u);

const storedMention = z.object({
  path: text,
  side: z.enum(['head', 'base']),
  startLine: line.optional(),
  endLine: line.optional(),
  sha: z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u),
});

const storedPart = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), id: partId, text: z.string() }),
  z.object({
    kind: z.literal('reasoning'),
    id: partId,
    state: z.enum(['running', 'done']),
    summary: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool-call'),
    id: partId,
    tool: text,
    description: z.string(),
    state: z.enum(['running', 'done', 'failed', 'stopped']),
  }),
  z.object({ kind: z.literal('mention'), id: partId, mention: storedMention }),
  z.object({ kind: z.literal('finding'), id: partId, finding: count }),
  z.object({ kind: z.literal('error'), id: partId, code: text }),
]);

function parseParts(value: unknown): ChatPart[] | undefined {
  const parts = parseJsonList(value, (item) => {
    const parsed = storedPart.safeParse(item);
    return parsed.success ? partFrom(parsed.data) : undefined;
  });
  const ids = new Set(parts?.map((part) => part.id));
  return parts?.length === ids.size ? parts : undefined;
}

/** Drops absent optional fields, so a parsed part equals the one stored. */
function partFrom(part: z.infer<typeof storedPart>): ChatPart | undefined {
  switch (part.kind) {
    case 'reasoning': {
      const { summary, ...rest } = part;
      return { ...rest, ...(summary !== undefined && { summary }) };
    }
    case 'mention': {
      const mention = mentionFrom(part.mention);
      return mention === undefined ? undefined : { ...part, mention };
    }
    default: {
      return part;
    }
  }
}

const answerKinds: readonly unknown[] = ['answer', 'review', 'abstract'] satisfies AnswerKind[];

function isAnswerKind(value: unknown): value is AnswerKind {
  return answerKinds.includes(value);
}

function parseReview(value: unknown): ChatReview | undefined | 'corrupt' {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return 'corrupt';
  }
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return 'corrupt';
  }
  const parsed = storedReview.safeParse(json);
  if (!parsed.success) {
    return 'corrupt';
  }
  const { reusedFrom, ...rest } = parsed.data;
  return { ...rest, ...(reusedFrom !== undefined && { reusedFrom }) };
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

function citationFrom(item: unknown): Citation | undefined {
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

function mentionFrom(item: unknown): ChatMention | undefined {
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
