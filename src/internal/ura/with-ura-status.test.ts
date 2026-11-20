import { describe } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import { withUraStatus } from './with-ura-status.ts';

describe('withUraStatus', () => {
  test('sets the status and the time, and still validates the item', ({ expect }) => {
    const now = Temporal.Instant.from('2026-10-29T08:00:00.000Z');
    const item = createTestUraItem();
    expect(withUraStatus(item, { kind: 'withdrawn' }, now)).toStrictEqual({
      ok: true,
      value: { ...item, status: { kind: 'withdrawn' }, updatedAt: '2026-10-29T08:00:00.000Z' },
    });
    const atWrittenHead = { kind: 'addressed', atSha: testUraIds.headSha, by: 'agent' } as const;
    expect(withUraStatus(item, atWrittenHead, now)).toMatchObject({ ok: false });
  });
});
