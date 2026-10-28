import { describe, expect, it } from 'vitest';

import { editUraItem } from './edit-ura-item.ts';
import { findUraItem } from './find-ura-item.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { listUraItems } from './list-ura-items.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { transitionUraItem } from './transition-ura-item.ts';
import type { UraItem } from './ura-item.ts';
import { updateUraItem } from './update-ura-item.ts';

const { sessionId, itemId } = testUraIds;
const later = new Date('2026-10-29T08:00:00.000Z');

/** One item of every anchor, origin and status shape, with patches where they fit. */
function sampleItems(): UraItem[] {
  return [
    createTestUraItem({ id: itemId(1), suggestion: '@@ -11 +11 @@\n-a\n+b\n' }),
    createTestUraItem({
      id: itemId(2),
      anchor: { kind: 'file', path: 'README.md' },
      origin: { kind: 'agent-insight', insightId: testUraIds.insightId },
      severity: 'question',
      suggestion: '@@ -1 +1 @@\n-# x\n+# y\n',
    }),
    createTestUraItem({
      id: itemId(3),
      anchor: { kind: 'lines', path: 'src/p.ts', startLine: 5, endLine: 40 },
      origin: {
        kind: 'impact-finding',
        metric: 'cognitive-complexity',
        functionName: 'parse',
        value: 21,
        threshold: 15,
        percentile: 87.5,
      },
    }),
    createTestUraItem({
      id: itemId(4),
      anchor: { kind: 'change' },
      origin: { kind: 'chat-answer', messageId: 'msg-1' },
      severity: 'praise',
      status: { kind: 'withdrawn' },
    }),
    createTestUraItem({
      id: itemId(5),
      status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'agent' },
    }),
  ];
}

describe('insertUraItem, listUraItems, findUraItem and updateUraItem', () => {
  it('round-trips every shape in insertion order', () => {
    const db = createUraTestDatabase([sessionId]);
    const items = sampleItems();
    for (const item of items) {
      expect(insertUraItem(db, item)).toEqual({ ok: true, value: undefined });
    }
    expect(listUraItems(db, sessionId)).toEqual({ ok: true, value: items });
    expect(findUraItem(db, itemId(3))).toEqual({ ok: true, value: items[2] });
    expect(listUraItems(db, testUraIds.otherSessionId)).toEqual({ ok: true, value: [] });
  });

  it('reports a missing session, a reused id and repeated staging', () => {
    const db = createUraTestDatabase([sessionId]);
    const [human, insight, finding] = sampleItems();
    if (human === undefined || insight === undefined || finding === undefined) {
      throw new Error('fixture');
    }
    const orphan = createTestUraItem({ sessionId: testUraIds.otherSessionId });
    expect(insertUraItem(db, orphan)).toEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: testUraIds.otherSessionId },
    });
    insertUraItem(db, human);
    expect(insertUraItem(db, human)).toEqual({
      ok: false,
      error: { kind: 'duplicate-item', id: human.id, reason: 'id-taken' },
    });
    insertUraItem(db, insight);
    expect(insertUraItem(db, { ...insight, id: itemId(8) })).toEqual({
      ok: false,
      error: { kind: 'duplicate-item', id: itemId(8), reason: 'insight-already-staged' },
    });
    insertUraItem(db, finding);
    expect(insertUraItem(db, { ...finding, id: itemId(9) })).toEqual({
      ok: false,
      error: { kind: 'duplicate-item', id: itemId(9), reason: 'finding-already-staged' },
    });
  });

  it('persists edits and transitions, and nothing else', () => {
    const db = createUraTestDatabase([sessionId]);
    const item = createTestUraItem({ suggestion: '@@ -11 +11 @@\n-a\n+b\n' });
    insertUraItem(db, item);
    const edited = editUraItem(
      item,
      { severity: 'blocker', body: 'Now urgent.', suggestion: '' },
      later,
    );
    if (!edited.ok) {
      throw new Error('edit');
    }
    expect(updateUraItem(db, edited.value)).toEqual({ ok: true, value: undefined });
    expect(findUraItem(db, item.id)).toEqual({ ok: true, value: edited.value });
    const status = { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'reviewer' } as const;
    const done = transitionUraItem(edited.value, status, later);
    if (!done.ok) {
      throw new Error('transition');
    }
    updateUraItem(db, done.value);
    expect(findUraItem(db, item.id)).toEqual({ ok: true, value: done.value });
    const moved = { ...done.value, anchor: { kind: 'change' } } as const;
    updateUraItem(db, moved);
    expect(findUraItem(db, item.id)).toEqual({ ok: true, value: done.value });
  });

  it('reports unknown items', () => {
    const db = createUraTestDatabase([sessionId]);
    const item = createTestUraItem();
    expect(updateUraItem(db, item)).toEqual({
      ok: false,
      error: { kind: 'item-not-found', id: item.id },
    });
    expect(findUraItem(db, item.id)).toEqual({
      ok: false,
      error: { kind: 'item-not-found', id: item.id },
    });
  });

  it('reports a corrupt row instead of returning it', () => {
    const db = createUraTestDatabase([sessionId]);
    const item = createTestUraItem();
    insertUraItem(db, item);
    db.prepare("UPDATE ura_items SET patch = '@@ -1 +1 @@\n-a\n+b\n' WHERE id = ?;").run(item.id);
    expect(listUraItems(db, sessionId)).toEqual({
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
