import { describe } from 'vitest';

import { findUraItemByOrigin } from './find-ura-item-by-origin.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraOrigin } from './ura-item.ts';
import { test } from './testing/test.ts';

describe('findUraItemByOrigin', () => {
  test('finds the item a repeated review finding or ImpactGate finding collides with', ({
    expect,
    db,
  }) => {
    const promoted = createTestUraItem({
      id: testUraIds.itemId(1),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 1 },
    });
    const staged = createTestUraItem({ id: testUraIds.itemId(2), origin: finding() });
    insertUraItem(db, promoted);
    insertUraItem(db, staged);

    const again = createTestUraItem({
      id: testUraIds.itemId(3),
      origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 1 },
    });
    expect(insertUraItem(db, again)).toMatchObject({
      ok: false,
      error: { kind: 'duplicate-item' },
    });
    expect(findUraItemByOrigin(db, again)).toStrictEqual({ ok: true, value: promoted });

    const repeat = createTestUraItem({
      id: testUraIds.itemId(4),
      origin: finding(),
      title: 'Other words',
    });
    expect(findUraItemByOrigin(db, repeat)).toStrictEqual({ ok: true, value: staged });
  });

  test('finds nothing for human items, other heads or other functions', ({ expect, db }) => {
    insertUraItem(db, createTestUraItem({ id: testUraIds.itemId(1), origin: finding() }));
    const human = createTestUraItem({ id: testUraIds.itemId(2) });
    expect(findUraItemByOrigin(db, human)).toStrictEqual({ ok: true, value: undefined });
    const laterHead = createTestUraItem({
      id: testUraIds.itemId(3),
      origin: finding(),
      headSha: testUraIds.laterHeadSha,
    });
    expect(findUraItemByOrigin(db, laterHead)).toStrictEqual({ ok: true, value: undefined });
    const other = createTestUraItem({
      id: testUraIds.itemId(4),
      origin: { ...finding(), functionName: 'other' },
    });
    expect(findUraItemByOrigin(db, other)).toStrictEqual({ ok: true, value: undefined });
  });
});

function finding(): Extract<UraOrigin, { kind: 'impact-finding' }> {
  return {
    kind: 'impact-finding',
    metric: 'cognitive-complexity',
    functionName: 'parse',
    value: 21,
    threshold: 15,
    percentile: 90,
  };
}
