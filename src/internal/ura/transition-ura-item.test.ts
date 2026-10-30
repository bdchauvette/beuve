import { describe, expect, it } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { transitionUraItem } from './transition-ura-item.ts';
import type { UraStatus } from './ura-item.ts';

const later = Temporal.Instant.from('2026-10-29T08:00:00.000Z');
const addressed: UraStatus = { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'reviewer' };

describe('transitionUraItem', () => {
  it('moves a staged item to addressed or withdrawn, and back', () => {
    const item = createTestUraItem({ suggestion: '@@ -11 +11 @@\n-a\n+b\n' });
    const done = transitionUraItem(item, addressed, later);
    expect(done).toEqual({
      ok: true,
      value: {
        ...item,
        status: addressed,
        updatedAt: later.toString({ fractionalSecondDigits: 3 }),
      },
    });
    const withdrawn = transitionUraItem(item, { kind: 'withdrawn' }, later);
    expect(withdrawn.ok && withdrawn.value.status).toEqual({ kind: 'withdrawn' });
    const restored = done.ok ? transitionUraItem(done.value, { kind: 'staged' }, later) : done;
    expect(restored.ok && restored.value.status).toEqual({ kind: 'staged' });
  });

  it('refuses transitions that skip staged', () => {
    const withdrawn = createTestUraItem({ status: { kind: 'withdrawn' } });
    expect(transitionUraItem(withdrawn, addressed, later)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'withdrawn', to: 'addressed' },
    });
    expect(transitionUraItem(createTestUraItem(), { kind: 'staged' }, later)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', from: 'staged', to: 'staged' },
    });
  });

  it('refuses addressing an item at the head it was written against', () => {
    const status: UraStatus = { kind: 'addressed', atSha: testUraIds.headSha, by: 'agent' };
    expect(transitionUraItem(createTestUraItem(), status, later)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-transition', to: 'addressed' },
    });
  });
});
