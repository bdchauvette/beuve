import { describe } from 'vitest';

import { deleteUraItem } from './delete-ura-item.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { listUraItems } from './list-ura-items.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('deleteUraItem', () => {
  test('removes only the named item', ({ expect, db }) => {
    for (const n of [1, 2]) {
      insertUraItem(
        db,
        createTestUraItem({ id: testUraIds.itemId(n), title: `Item ${String(n)}` }),
      );
    }
    expect(deleteUraItem(db, testUraIds.itemId(1))).toStrictEqual({ ok: true, value: undefined });
    const items = listUraItems(db, testUraIds.sessionId);
    expect(items.ok && items.value.map((item) => item.title)).toStrictEqual(['Item 2']);
  });

  test('says when there is no such item', ({ expect, db }) => {
    expect(deleteUraItem(db, testUraIds.itemId(1))).toStrictEqual({
      ok: false,
      error: { kind: 'item-not-found', id: testUraIds.itemId(1) },
    });
  });
});
