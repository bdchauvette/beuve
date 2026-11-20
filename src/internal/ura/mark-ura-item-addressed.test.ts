import { describe } from 'vitest';

import { markUraItemAddressed } from './mark-ura-item-addressed.ts';
import type { UraAddressing } from './mark-ura-item-addressed.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('markUraItemAddressed', () => {
  test('marks a staged or a withdrawn note addressed at a later head', ({ expect }) => {
    const staged = createTestUraItem();
    expect(markUraItemAddressed(staged, addressing())).toStrictEqual({
      ok: true,
      value: {
        ...staged,
        status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'reviewer' },
        updatedAt: addressing().now.toString({ fractionalSecondDigits: 3 }),
      },
    });
    const withdrawn = createTestUraItem({ status: { kind: 'withdrawn' } });
    expect(markUraItemAddressed(withdrawn, addressing())).toMatchObject({
      ok: true,
      value: { status: { kind: 'addressed', by: 'reviewer' } },
    });
  });

  test('refuses a note already addressed', ({ expect }) => {
    const addressed = createTestUraItem({
      status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'agent' },
    });
    expect(markUraItemAddressed(addressed, addressing())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'addressed', to: 'addressed' },
    });
  });

  test('refuses the head the note was written against', ({ expect }) => {
    expect(
      markUraItemAddressed(createTestUraItem(), { ...addressing(), atSha: testUraIds.headSha }),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-transition', to: 'addressed' } });
  });
});

function addressing(): UraAddressing {
  return {
    atSha: testUraIds.laterHeadSha,
    by: 'reviewer',
    now: Temporal.Instant.from('2026-10-29T08:00:00.000Z'),
  };
}
