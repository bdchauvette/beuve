import type { SQLOutputValue } from 'node:sqlite';

import { describe } from 'vitest';

import { uraItemFromRow } from './ura-item-from-row.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { uraItemRowFrom } from './ura-item-row-from.ts';
import type { UraItem } from './ura-item.ts';
import { test } from './testing/test.ts';

/** The row SQLite would return for the fixture item, with NULLs for unset columns. */
function row(overrides: Record<string, SQLOutputValue> = {}): Record<string, SQLOutputValue> {
  const nullable = [
    'chat_message_id',
    'chat_finding',
    'chat_proposal',
    'chat_confidence',
    'addressed_sha',
    'addressed_by',
  ];
  const nulls = Object.fromEntries(
    nullable.map((column) => {
      // eslint-disable-next-line unicorn/no-null -- SQLite returns NULL columns as null
      return [column, null];
    }),
  );
  return {
    ...nulls,
    position: 0,
    ...(uraItemRowFrom(item()) as Record<string, SQLOutputValue>),
    ...overrides,
  };
}

function reasonOf(overrides: Record<string, SQLOutputValue>): string | undefined {
  const result = uraItemFromRow(row(overrides), []);
  if (result.ok) {
    return undefined;
  }
  return result.error.reason;
}

describe('uraItemFromRow', () => {
  test('maps a valid row, with integers as numbers or bigints', ({ expect }) => {
    expect(uraItemFromRow(row(), [])).toStrictEqual({ ok: true, value: item() });
    expect(uraItemFromRow(row({ line_start: 10n, line_end: 12n }), [])).toStrictEqual({
      ok: true,
      value: item(),
    });
  });

  test('maps a proposed note’s origin both ways', ({ expect }) => {
    const proposed = createTestUraItem({
      origin: { kind: 'chat-answer', messageId: 'm1', proposal: 2 },
    });
    expect(
      uraItemFromRow(
        {
          ...row(),
          ...(uraItemRowFrom(proposed) as Record<string, SQLOutputValue>),
        },
        [],
      ),
    ).toStrictEqual({ ok: true, value: proposed });
  });

  test('maps a review finding’s confidence both ways', ({ expect }) => {
    const finding = createTestUraItem({
      origin: { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: 0.75 },
    });
    expect(
      uraItemFromRow(
        { ...row(), ...(uraItemRowFrom(finding) as Record<string, SQLOutputValue>) },
        [],
      ),
    ).toStrictEqual({ ok: true, value: finding });
  });

  test.for<[string, SQLOutputValue, string]>([
    ['id', 'x', 'id or session_id is not a UUID'],
    ['head_sha', 'ABC', 'head_sha is not a commit id'],
    ['severity', 'major', 'severity is unknown'],
    ['severity', 'blocker', 'severity is unknown'],
    ['blocking', 2, 'blocking is not 0 or 1'],
    ['blocking', 'yes', 'blocking is not 0 or 1'],
    ['title', 7, 'title or body is not text'],
    ['updated_at', 'now', 'created_at or updated_at is not an ISO-8601 UTC timestamp'],
    ['anchor_kind', 'hunk', 'anchor_kind is unknown'],
    ['line_end', 1.5, 'path, line_start or line_end is missing'],
    ['origin_kind', 'bot', 'origin_kind is unknown'],
    ['status', 'pending', 'status is unknown'],
    ['line_start', 20, 'invalid-anchor: the end line comes before the start line'],
  ])('reports a bad %s', ([column, value, reason], { expect }) => {
    expect(reasonOf({ [column]: value })).toBe(reason);
  });

  test('maps suggestion rows in order, with integers as numbers or bigints', ({ expect }) => {
    const [first, second] = [testUraIds.suggestionId(1), testUraIds.suggestionId(2)];
    const rows = [
      { id: first, path: 'src/b.ts', start_line: 4n, end_line: 3n, replacement: 'new' },
      { id: second, path: 'src/app.ts', start_line: 10, end_line: 11, replacement: '' },
    ];
    expect(uraItemFromRow(row(), rows)).toStrictEqual({
      ok: true,
      value: {
        ...item(),
        suggestions: [
          { id: first, path: 'src/b.ts', startLine: 4, endLine: 3, replacement: 'new' },
          { id: second, path: 'src/app.ts', startLine: 10, endLine: 11, replacement: '' },
        ],
      },
    });
  });

  test('reports bad suggestion rows', ({ expect }) => {
    const good = {
      id: testUraIds.suggestionId(1),
      path: 'src/b.ts',
      start_line: 4,
      end_line: 4,
      replacement: 'x',
    };
    expect(uraItemFromRow(row(), [{ ...good, replacement: 7 }])).toMatchObject({
      ok: false,
      error: {
        table: 'ura_item_suggestions',
        reason: 'id, path, start_line, end_line or replacement is missing',
      },
    });
    expect(
      uraItemFromRow(row(), [good, { ...good, id: testUraIds.suggestionId(2) }]),
    ).toMatchObject({
      ok: false,
      error: { reason: 'invalid-suggestion: suggestions of one note must not overlap' },
    });
    expect(uraItemFromRow(row(), [{ ...good, id: 'x' }])).toMatchObject({
      ok: false,
      error: { reason: "invalid-suggestion: a suggestion's id is a UUID" },
    });
  });

  test('reports incomplete origins and statuses', ({ expect }) => {
    expect(reasonOf({ origin_kind: 'chat-answer' })).toBe('chat_message_id is not text');
    expect(reasonOf({ origin_kind: 'chat-answer', chat_message_id: 'm', chat_finding: -1 })).toBe(
      'chat_finding is not a finding index',
    );
    expect(reasonOf({ origin_kind: 'chat-answer', chat_message_id: 'm', chat_proposal: -1 })).toBe(
      'chat_proposal is not a proposal index',
    );
    expect(
      reasonOf({
        origin_kind: 'chat-answer',
        chat_message_id: 'm',
        chat_finding: 0,
        chat_proposal: 0,
      }),
    ).toBe('chat_finding and chat_proposal are both set');
    expect(
      reasonOf({
        origin_kind: 'chat-answer',
        chat_message_id: 'm',
        chat_finding: 0,
        chat_confidence: 'high',
      }),
    ).toBe('chat_confidence is not a number');
    expect(
      reasonOf({
        origin_kind: 'chat-answer',
        chat_message_id: 'm',
        chat_proposal: 0,
        chat_confidence: 0.5,
      }),
    ).toBe('chat_confidence is set without chat_finding');
    expect(
      reasonOf({
        origin_kind: 'chat-answer',
        chat_message_id: 'm',
        chat_finding: 0,
        chat_confidence: 2,
      }),
    ).toBe('invalid-origin: the confidence is not between 0 and 1');
    expect(reasonOf({ origin_kind: 'impact-finding' })).toBe('origin_kind is unknown');
    expect(reasonOf({ status: 'addressed', addressed_sha: 'b'.repeat(40) })).toBe(
      'addressed_sha or addressed_by is invalid',
    );
  });
});

function item(): UraItem {
  return createTestUraItem();
}
