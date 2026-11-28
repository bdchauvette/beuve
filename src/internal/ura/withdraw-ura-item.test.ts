import { describe } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import { withdrawUraItem } from './withdraw-ura-item.ts';

describe('withdrawUraItem', () => {
  test('withdraws a staged or an addressed note', ({ expect }) => {
    const staged = createTestUraItem({
      suggestions: [{ path: 'src/app.ts', startLine: 11, endLine: 11, replacement: 'b' }],
    });
    expect(withdrawUraItem(staged, later())).toStrictEqual({
      ok: true,
      value: {
        ...staged,
        status: { kind: 'withdrawn' },
        updatedAt: later().toString({ fractionalSecondDigits: 3 }),
      },
    });
    const addressed = createTestUraItem({
      status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'agent' },
    });
    expect(withdrawUraItem(addressed, later())).toMatchObject({
      ok: true,
      value: { status: { kind: 'withdrawn' } },
    });
  });

  test('refuses a note already withdrawn', ({ expect }) => {
    const withdrawn = createTestUraItem({ status: { kind: 'withdrawn' } });
    expect(withdrawUraItem(withdrawn, later())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'withdrawn', to: 'withdrawn' },
    });
  });
});

function later(): Temporal.Instant {
  return Temporal.Instant.from('2026-10-29T08:00:00.000Z');
}
