import { describe } from 'vitest';

import { editUraItem } from './edit-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { test } from './testing/test.ts';

describe('editUraItem', () => {
  test('changes severity, title and body and bumps updatedAt', ({ expect }) => {
    const item = createTestUraItem();
    const result = editUraItem(
      item,
      { severity: 'blocker', title: ' New ', body: 'More.' },
      later(),
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        ...item,
        severity: 'blocker',
        title: 'New',
        body: 'More.',
        updatedAt: later().toString({ fractionalSecondDigits: 3 }),
      },
    });
  });

  test('keeps, replaces or removes the suggestion', ({ expect }) => {
    const item = createTestUraItem({ suggestion: patch() });
    const kept = editUraItem(item, { body: 'x' }, later());
    expect(kept.ok && kept.value.suggestion).toStrictEqual(item.suggestion);
    const replaced = editUraItem(item, { suggestion: '@@ -12 +12 @@\n-c\n+d\n' }, later());
    expect(replaced.ok && replaced.value.suggestion?.hunks[0]?.oldStart).toBe(12);
    const removed = editUraItem(item, { suggestion: '' }, later());
    expect(removed.ok && removed.value.suggestion).toBeUndefined();
  });

  test('validates the result', ({ expect }) => {
    expect(editUraItem(createTestUraItem(), { title: '', body: '' }, later()).ok).toBe(false);
    expect(
      editUraItem(createTestUraItem(), { suggestion: '@@ -1 +1 @@\n-a\n+b\n' }, later()).ok,
    ).toBe(false);
  });
});

function later(): Temporal.Instant {
  return Temporal.Instant.from('2026-10-29T08:00:00.000Z');
}

function patch(): string {
  return '@@ -11 +11 @@\n-a\n+b\n';
}
