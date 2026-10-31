import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import type { UraItemId } from './ura-item.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { listUraItems } from './list-ura-items.ts';
import { reorderUraItems } from './reorder-ura-items.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

function seed(db: DatabaseSync): void {
  for (const n of [1, 2, 3]) {
    insertUraItem(db, createTestUraItem({ id: testUraIds.itemId(n), title: `Item ${String(n)}` }));
  }
  insertUraItem(
    db,
    createTestUraItem({ id: testUraIds.itemId(9), sessionId: testUraIds.otherSessionId }),
  );
}

function titles(db: DatabaseSync): string[] {
  const items = listUraItems(db, testUraIds.sessionId);
  if (items.ok) {
    return items.value.map((item) => item.title);
  }
  return [];
}

describe('reorderUraItems', () => {
  test('puts the items in the given order, and new items go last', ({ expect, db }) => {
    seed(db);
    expect(
      reorderUraItems(db, testUraIds.sessionId, [
        testUraIds.itemId(3),
        testUraIds.itemId(1),
        testUraIds.itemId(2),
      ]),
    ).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(titles(db)).toStrictEqual(['Item 3', 'Item 1', 'Item 2']);
    insertUraItem(db, createTestUraItem({ id: testUraIds.itemId(4), title: 'Item 4' }));
    expect(titles(db)).toStrictEqual(['Item 3', 'Item 1', 'Item 2', 'Item 4']);
  });

  test.for<[string, UraItemId[]]>([
    ['an item is missing', [testUraIds.itemId(3), testUraIds.itemId(1)]],
    ['an item repeats', [testUraIds.itemId(3), testUraIds.itemId(1), testUraIds.itemId(1)]],
    [
      'an item is unknown',
      [testUraIds.itemId(3), testUraIds.itemId(1), testUraIds.itemId(2), testUraIds.itemId(7)],
    ],
    [
      "another session's item is named",
      [testUraIds.itemId(3), testUraIds.itemId(1), testUraIds.itemId(9)],
    ],
  ])('changes nothing when %s', ([, ids], { expect, db }) => {
    seed(db);
    expect(reorderUraItems(db, testUraIds.sessionId, ids)).toStrictEqual({
      ok: false,
      error: { kind: 'order-mismatch', sessionId: testUraIds.sessionId },
    });
    expect(titles(db)).toStrictEqual(['Item 1', 'Item 2', 'Item 3']);
  });
});
