import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { editUraItem } from './edit-ura-item.ts';
import { findUraItem } from './find-ura-item.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { listUraItems } from './list-ura-items.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { transitionUraItem } from './transition-ura-item.ts';
import type { SessionId, UraItem } from './ura-item.ts';
import { updateUraItem } from './update-ura-item.ts';
import { test } from './testing/test.ts';

/** One item of every anchor, origin and status shape, with patches where they fit. */
function sampleItems(): [UraItem, UraItem, UraItem, UraItem, UraItem] {
  return [
    createTestUraItem({ id: testUraIds.itemId(1), suggestion: '@@ -11 +11 @@\n-a\n+b\n' }),
    createTestUraItem({
      id: testUraIds.itemId(2),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 0 },
      severity: 'question',
    }),
    createTestUraItem({
      id: testUraIds.itemId(3),
      anchor: { kind: 'lines', path: 'src/p.ts', startLine: 5, endLine: 40 },
      origin: { kind: 'chat-answer', messageId: 'msg-2', proposal: 0 },
    }),
    createTestUraItem({
      id: testUraIds.itemId(4),
      anchor: { kind: 'change' },
      severity: 'praise',
      status: { kind: 'withdrawn' },
    }),
    createTestUraItem({
      id: testUraIds.itemId(5),
      anchor: { kind: 'file', path: 'README.md' },
      status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'agent' },
    }),
  ];
}

describe('insertUraItem, listUraItems, findUraItem and updateUraItem', () => {
  test('round-trips every shape in insertion order', ({ expect, db }) => {
    const items = sampleItems();
    for (const item of items) {
      expect(insertUraItem(db, item)).toStrictEqual({ ok: true, value: undefined });
    }
    expect(listUraItems(db, testUraIds.sessionId)).toStrictEqual({ ok: true, value: items });
    expect(findUraItem(db, testUraIds.itemId(3))).toStrictEqual({ ok: true, value: items[2] });
    expect(listUraItems(db, testUraIds.otherSessionId)).toStrictEqual({ ok: true, value: [] });
  });

  test('reports a missing session, a reused id and repeated staging', ({ expect, db }) => {
    const [human, reviewFinding] = sampleItems();
    const unknown = '55555555-5555-4555-8555-555555555555' as SessionId;
    const orphan = createTestUraItem({ sessionId: unknown });
    expect(insertUraItem(db, orphan)).toStrictEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: unknown },
    });
    insertUraItem(db, human);
    expect(insertUraItem(db, human)).toStrictEqual({
      ok: false,
      error: { kind: 'duplicate-item', id: human.id, reason: 'id-taken' },
    });
    insertUraItem(db, reviewFinding);
    expect(insertUraItem(db, { ...reviewFinding, id: testUraIds.itemId(8) })).toStrictEqual({
      ok: false,
      error: {
        kind: 'duplicate-item',
        id: testUraIds.itemId(8),
        reason: 'origin-already-staged',
      },
    });
  });

  test('persists edits and transitions, and nothing else', ({ expect, db }) => {
    const item = createTestUraItem({ suggestion: '@@ -11 +11 @@\n-a\n+b\n' });
    insertUraItem(db, item);
    const edited = okValueFrom(
      editUraItem(item, { blocking: true, body: 'Now urgent.', suggestion: '' }, later()),
    );
    expect(updateUraItem(db, edited)).toStrictEqual({ ok: true, value: undefined });
    expect(findUraItem(db, item.id)).toStrictEqual({ ok: true, value: edited });
    const status = { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'reviewer' } as const;
    const done = okValueFrom(transitionUraItem(edited, status, later()));
    updateUraItem(db, done);
    expect(findUraItem(db, item.id)).toStrictEqual({ ok: true, value: done });
    const moved = { ...done, anchor: { kind: 'change' } } as const;
    updateUraItem(db, moved);
    expect(findUraItem(db, item.id)).toStrictEqual({ ok: true, value: done });
  });

  test('reports unknown items', ({ expect, db }) => {
    const item = createTestUraItem();
    expect(updateUraItem(db, item)).toStrictEqual({
      ok: false,
      error: { kind: 'item-not-found', id: item.id },
    });
    expect(findUraItem(db, item.id)).toStrictEqual({
      ok: false,
      error: { kind: 'item-not-found', id: item.id },
    });
  });

  test('reports a corrupt row instead of returning it', ({ expect, db }) => {
    const item = createTestUraItem();
    insertUraItem(db, item);
    db.prepare("UPDATE ura_items SET patch = '@@ -1 +1 @@\n-a\n+b\n' WHERE id = ?;").run(item.id);
    expect(listUraItems(db, testUraIds.sessionId)).toStrictEqual({
      ok: false,
      error: {
        kind: 'corrupt-row',
        table: 'ura_items',
        id: item.id,
        reason: 'invalid-patch: the patch changes lines outside 10–12',
      },
    });
  });
});

function later(): Temporal.Instant {
  return Temporal.Instant.from('2026-10-29T08:00:00.000Z');
}
