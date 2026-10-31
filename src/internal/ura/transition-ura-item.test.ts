import { describe } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { transitionUraItem } from './transition-ura-item.ts';
import type { UraStatus } from './ura-item.ts';
import { test } from './testing/test.ts';

import { okValueFrom } from '#testing/ok-value-from.ts';

describe('transitionUraItem', () => {
  test('moves a staged item to addressed or withdrawn, and back', ({ expect }) => {
    const item = createTestUraItem({ suggestion: '@@ -11 +11 @@\n-a\n+b\n' });
    const done = transitionUraItem(item, addressed(), later());
    expect(done).toStrictEqual({
      ok: true,
      value: {
        ...item,
        status: addressed(),
        updatedAt: later().toString({ fractionalSecondDigits: 3 }),
      },
    });
    const withdrawn = transitionUraItem(item, { kind: 'withdrawn' }, later());
    expect(withdrawn.ok && withdrawn.value.status).toStrictEqual({ kind: 'withdrawn' });
    const restored = transitionUraItem(okValueFrom(done), { kind: 'staged' }, later());
    expect(restored.ok && restored.value.status).toStrictEqual({ kind: 'staged' });
  });

  test('refuses transitions that skip staged', ({ expect }) => {
    const withdrawn = createTestUraItem({ status: { kind: 'withdrawn' } });
    expect(transitionUraItem(withdrawn, addressed(), later())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'withdrawn', to: 'addressed' },
    });
    expect(transitionUraItem(createTestUraItem(), { kind: 'staged' }, later())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'staged', to: 'staged' },
    });
  });

  test('refuses addressing an item at the head it was written against', ({ expect }) => {
    const status: UraStatus = { kind: 'addressed', atSha: testUraIds.headSha, by: 'agent' };
    expect(transitionUraItem(createTestUraItem(), status, later())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', to: 'addressed' },
    });
  });
});

function later(): Temporal.Instant {
  return Temporal.Instant.from('2026-10-29T08:00:00.000Z');
}

function addressed(): UraStatus {
  return { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'reviewer' };
}
