import { describe, expect, it } from 'vitest';

import { insertUraItem } from './insert-ura-item.ts';
import { listUraItems } from './list-ura-items.ts';
import { reorderUraItems } from './reorder-ura-items.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import { testUraIds } from './testing/test-ura-ids.ts';

const { sessionId, itemId } = testUraIds;

function setup(): ReturnType<typeof createUraTestDatabase> {
  const db = createUraTestDatabase([sessionId, testUraIds.otherSessionId]);
  for (const n of [1, 2, 3]) {
    insertUraItem(db, createTestUraItem({ id: itemId(n), title: `Item ${String(n)}` }));
  }
  insertUraItem(db, createTestUraItem({ id: itemId(9), sessionId: testUraIds.otherSessionId }));
  return db;
}

function titles(db: ReturnType<typeof createUraTestDatabase>): string[] {
  const items = listUraItems(db, sessionId);
  return items.ok ? items.value.map((item) => item.title) : [];
}

describe('reorderUraItems', () => {
  it('puts the items in the given order, and new items go last', () => {
    const db = setup();
    expect(reorderUraItems(db, sessionId, [itemId(3), itemId(1), itemId(2)])).toEqual({
      ok: true,
      value: undefined,
    });
    expect(titles(db)).toEqual(['Item 3', 'Item 1', 'Item 2']);
    insertUraItem(db, createTestUraItem({ id: itemId(4), title: 'Item 4' }));
    expect(titles(db)).toEqual(['Item 3', 'Item 1', 'Item 2', 'Item 4']);
  });

  it.each([
    ['an item is missing', [itemId(3), itemId(1)]],
    ['an item repeats', [itemId(3), itemId(1), itemId(1)]],
    ['an item is unknown', [itemId(3), itemId(1), itemId(2), itemId(7)]],
    ["another session's item is named", [itemId(3), itemId(1), itemId(9)]],
  ])('changes nothing when %s', (_name, ids) => {
    const db = setup();
    expect(reorderUraItems(db, sessionId, ids)).toEqual({
      ok: false,
      error: { kind: 'order-mismatch', sessionId },
    });
    expect(titles(db)).toEqual(['Item 1', 'Item 2', 'Item 3']);
  });
});
