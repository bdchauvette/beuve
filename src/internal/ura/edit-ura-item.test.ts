import { describe } from 'vitest';

import { editUraItem } from './edit-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { test } from './testing/test.ts';
import type { UraSuggestion } from './ura-item.ts';

describe('editUraItem', () => {
  test('changes the label, blocking, title and body and bumps updatedAt', ({ expect }) => {
    const item = createTestUraItem();
    const result = editUraItem(
      item,
      { severity: 'smell', blocking: true, title: ' New ', body: 'More.' },
      later(),
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        ...item,
        severity: 'smell',
        blocking: true,
        title: 'New',
        body: 'More.',
        updatedAt: later().toString({ fractionalSecondDigits: 3 }),
      },
    });
  });

  test('keeps, replaces or removes the suggestions', ({ expect }) => {
    const item = createTestUraItem({ suggestions: [suggestion(11)] });
    const kept = editUraItem(item, { body: 'x' }, later());
    expect(kept.ok && kept.value.suggestions).toStrictEqual([suggestion(11)]);
    const replaced = editUraItem(item, { suggestions: [suggestion(12), suggestion(40)] }, later());
    expect(replaced.ok && replaced.value.suggestions).toStrictEqual([
      suggestion(12),
      suggestion(40),
    ]);
    const removed = editUraItem(item, { suggestions: [] }, later());
    expect(removed.ok && removed.value.suggestions).toStrictEqual([]);
  });

  test('validates the result', ({ expect }) => {
    expect(editUraItem(createTestUraItem(), { title: '', body: '' }, later()).ok).toBe(false);
    expect(
      editUraItem(createTestUraItem(), { suggestions: [suggestion(1), suggestion(1)] }, later()).ok,
    ).toBe(false);
  });
});

function later(): Temporal.Instant {
  return Temporal.Instant.from('2026-10-29T08:00:00.000Z');
}

function suggestion(line: number): UraSuggestion {
  return { path: 'src/app.ts', startLine: line, endLine: line, replacement: 'b' };
}
