import type { SQLOutputValue } from 'node:sqlite';

import { describe } from 'vitest';

import { uraItemFromRow } from './ura-item-from-row.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { uraItemRowFrom } from './ura-item-row-from.ts';
import type { UraItem } from './ura-item.ts';
import { test } from './testing/test.ts';

/** The row SQLite would return for the fixture item, with NULLs for unset columns. */
function row(overrides: Record<string, SQLOutputValue> = {}): Record<string, SQLOutputValue> {
  const nullable = [
    'chat_message_id',
    'chat_finding',
    'impact_metric',
    'impact_function',
    'impact_value',
    'impact_threshold',
    'impact_percentile',
    'patch',
    'addressed_sha',
    'addressed_by',
  ];
  // eslint-disable-next-line unicorn/no-null -- SQLite returns NULL columns as null
  const nulls = Object.fromEntries(nullable.map((column) => [column, null]));
  return {
    ...nulls,
    position: 0,
    ...(uraItemRowFrom(item()) as Record<string, SQLOutputValue>),
    ...overrides,
  };
}

function reasonOf(overrides: Record<string, SQLOutputValue>): string | undefined {
  const result = uraItemFromRow(row(overrides));
  return result.ok ? undefined : result.error.reason;
}

describe('uraItemFromRow', () => {
  test('maps a valid row, with integers as numbers or bigints', ({ expect }) => {
    expect(uraItemFromRow(row())).toStrictEqual({ ok: true, value: item() });
    expect(uraItemFromRow(row({ line_start: 10n, line_end: 12n }))).toStrictEqual({
      ok: true,
      value: item(),
    });
  });

  test.for<[string, SQLOutputValue, string]>([
    ['id', 'x', 'id or session_id is not a UUID'],
    ['head_sha', 'ABC', 'head_sha is not a commit id'],
    ['severity', 'major', 'severity is unknown'],
    ['title', 7, 'title or body is not text'],
    ['patch', 7, 'patch is not text'],
    ['updated_at', 'now', 'created_at or updated_at is not an ISO-8601 UTC timestamp'],
    ['anchor_kind', 'hunk', 'anchor_kind is unknown'],
    ['line_end', 1.5, 'path, line_start or line_end is missing'],
    ['origin_kind', 'bot', 'origin_kind is unknown'],
    ['status', 'pending', 'status is unknown'],
    ['line_start', 20, 'invalid-anchor: the end line comes before the start line'],
  ])('reports a bad %s', ([column, value, reason], { expect }) => {
    expect(reasonOf({ [column]: value })).toBe(reason);
  });

  test('reports incomplete origins and statuses', ({ expect }) => {
    expect(reasonOf({ origin_kind: 'chat-answer' })).toBe('chat_message_id is not text');
    expect(reasonOf({ origin_kind: 'chat-answer', chat_message_id: 'm', chat_finding: -1 })).toBe(
      'chat_finding is not a finding index',
    );
    expect(reasonOf({ origin_kind: 'impact-finding', impact_metric: 'cognitive-complexity' })).toBe(
      'the ImpactGate columns are incomplete',
    );
    expect(reasonOf({ status: 'addressed', addressed_sha: 'b'.repeat(40) })).toBe(
      'addressed_sha or addressed_by is invalid',
    );
  });
});

function item(): UraItem {
  return createTestUraItem();
}
