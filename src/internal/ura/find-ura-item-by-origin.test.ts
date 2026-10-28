import { describe, expect, it } from 'vitest';

import { findUraItemByOrigin } from './find-ura-item-by-origin.ts';
import { insertUraItem } from './insert-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraOrigin } from './ura-item.ts';

const { sessionId, itemId, insightId, laterHeadSha } = testUraIds;

const finding: UraOrigin = {
  kind: 'impact-finding',
  metric: 'cognitive-complexity',
  functionName: 'parse',
  value: 21,
  threshold: 15,
  percentile: 90,
};

describe('findUraItemByOrigin', () => {
  it('finds the item a repeated insight or finding collides with', () => {
    const db = createUraTestDatabase([sessionId]);
    const promoted = createTestUraItem({
      id: itemId(1),
      origin: { kind: 'agent-insight', insightId },
    });
    const staged = createTestUraItem({ id: itemId(2), origin: finding });
    insertUraItem(db, promoted);
    insertUraItem(db, staged);

    const again = createTestUraItem({
      id: itemId(3),
      origin: { kind: 'agent-insight', insightId },
    });
    expect(insertUraItem(db, again)).toMatchObject({
      ok: false,
      error: { kind: 'duplicate-item' },
    });
    expect(findUraItemByOrigin(db, again)).toEqual({ ok: true, value: promoted });

    const repeat = createTestUraItem({ id: itemId(4), origin: finding, title: 'Other words' });
    expect(findUraItemByOrigin(db, repeat)).toEqual({ ok: true, value: staged });
  });

  it('finds nothing for human items, other heads or other functions', () => {
    const db = createUraTestDatabase([sessionId]);
    insertUraItem(db, createTestUraItem({ id: itemId(1), origin: finding }));
    const human = createTestUraItem({ id: itemId(2) });
    expect(findUraItemByOrigin(db, human)).toEqual({ ok: true, value: undefined });
    const laterHead = createTestUraItem({ id: itemId(3), origin: finding, headSha: laterHeadSha });
    expect(findUraItemByOrigin(db, laterHead)).toEqual({ ok: true, value: undefined });
    const other = createTestUraItem({
      id: itemId(4),
      origin: { ...finding, functionName: 'other' },
    });
    expect(findUraItemByOrigin(db, other)).toEqual({ ok: true, value: undefined });
  });
});
