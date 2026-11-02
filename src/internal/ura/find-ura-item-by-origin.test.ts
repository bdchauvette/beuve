import { describe } from 'vitest';

import { findUraItemByOrigin } from './find-ura-item-by-origin.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('findUraItemByOrigin', () => {
  test('finds the item a repeated review finding collides with', ({ expect, db }) => {
    const promoted = createTestUraItem({
      id: testUraIds.itemId(1),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 1 },
    });
    insertUraItem(db, promoted);

    const again = createTestUraItem({
      id: testUraIds.itemId(3),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 1 },
    });
    expect(insertUraItem(db, again)).toMatchObject({
      ok: false,
      error: { kind: 'duplicate-item' },
    });
    expect(findUraItemByOrigin(db, again)).toStrictEqual({ ok: true, value: promoted });
  });

  test('finds nothing for human items, other answers or other findings', ({ expect, db }) => {
    insertUraItem(
      db,
      createTestUraItem({
        id: testUraIds.itemId(1),
        origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 1 },
      }),
    );
    const human = createTestUraItem({ id: testUraIds.itemId(2) });
    expect(findUraItemByOrigin(db, human)).toStrictEqual({ ok: true, value: undefined });
    const otherFinding = createTestUraItem({
      id: testUraIds.itemId(3),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 2 },
    });
    expect(findUraItemByOrigin(db, otherFinding)).toStrictEqual({ ok: true, value: undefined });
    const wholeAnswer = createTestUraItem({
      id: testUraIds.itemId(4),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId },
    });
    expect(findUraItemByOrigin(db, wholeAnswer)).toStrictEqual({ ok: true, value: undefined });
  });
});
