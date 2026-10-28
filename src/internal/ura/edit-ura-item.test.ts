import { describe, expect, it } from 'vitest';

import { editUraItem } from './edit-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';

const later = new Date('2026-10-29T08:00:00.000Z');
const patch = '@@ -11 +11 @@\n-a\n+b\n';

describe('editUraItem', () => {
  it('changes severity, title and body and bumps updatedAt', () => {
    const item = createTestUraItem();
    const result = editUraItem(item, { severity: 'blocker', title: ' New ', body: 'More.' }, later);
    expect(result).toEqual({
      ok: true,
      value: {
        ...item,
        severity: 'blocker',
        title: 'New',
        body: 'More.',
        updatedAt: later.toISOString(),
      },
    });
  });

  it('keeps, replaces or removes the suggestion', () => {
    const item = createTestUraItem({ suggestion: patch });
    const kept = editUraItem(item, { body: 'x' }, later);
    expect(kept.ok && kept.value.suggestion).toEqual(item.suggestion);
    const replaced = editUraItem(item, { suggestion: '@@ -12 +12 @@\n-c\n+d\n' }, later);
    expect(replaced.ok && replaced.value.suggestion?.hunks[0]?.oldStart).toBe(12);
    const removed = editUraItem(item, { suggestion: '' }, later);
    expect(removed.ok && removed.value.suggestion).toBeUndefined();
  });

  it('validates the result', () => {
    expect(editUraItem(createTestUraItem(), { title: '' }, later).ok).toBe(false);
    expect(
      editUraItem(createTestUraItem(), { suggestion: '@@ -1 +1 @@\n-a\n+b\n' }, later).ok,
    ).toBe(false);
  });
});
