import { describe } from 'vitest';

import { reopenUraItem } from './reopen-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('reopenUraItem', () => {
  test('reopens a withdrawn or an addressed note', ({ expect }) => {
    const withdrawn = createTestUraItem({ status: { kind: 'withdrawn' } });
    const addressed = createTestUraItem({
      status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'reviewer' },
    });
    expect(reopenUraItem(withdrawn, later())).toMatchObject({
      ok: true,
      value: { status: { kind: 'staged' } },
    });
    expect(reopenUraItem(addressed, later())).toMatchObject({
      ok: true,
      value: { status: { kind: 'staged' } },
    });
  });

  test('refuses a note already staged', ({ expect }) => {
    expect(reopenUraItem(createTestUraItem(), later())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'staged', to: 'staged' },
    });
  });
});

function later(): Temporal.Instant {
  return Temporal.Instant.from('2026-10-29T08:00:00.000Z');
}
