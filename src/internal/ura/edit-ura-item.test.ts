import { describe } from 'vitest';

import { editUraItem } from './edit-ura-item.ts';
import type { UraEditContext } from './edit-ura-item.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { fixedUraDeps } from './testing/fixed-ura-deps.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import type { UraSuggestionDraft } from './ura-item.ts';

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
        updatedAt: '2026-10-29T08:00:00.000Z',
      },
    });
  });

  test('keeps, replaces or removes the suggestions', ({ expect }) => {
    const item = createTestUraItem({ suggestions: [suggestion(11)] });
    const kept = editUraItem(item, { body: 'x' }, later());
    expect(kept.ok && kept.value.suggestions).toStrictEqual(item.suggestions);
    const replaced = editUraItem(item, { suggestions: [suggestion(12), suggestion(40)] }, later());
    expect(replaced.ok && replaced.value.suggestions).toStrictEqual([
      { ...suggestion(12), id: newId(1) },
      { ...suggestion(40), id: newId(2) },
    ]);
    const removed = editUraItem(item, { suggestions: [] }, later());
    expect(removed.ok && removed.value.suggestions).toStrictEqual([]);
  });

  test('keeps the id of a suggestion sent back with it, and gives every other one a new id', ({
    expect,
  }) => {
    const item = createTestUraItem({ suggestions: [suggestion(11), suggestion(20)] });
    const [first, second] = item.suggestions;
    const edited = editUraItem(
      item,
      {
        suggestions: [
          { ...suggestion(21), id: second?.id ?? '' },
          { ...suggestion(30), id: second?.id ?? '' },
          { ...suggestion(31), id: testUraIds.suggestionId(99) },
          suggestion(32),
        ],
      },
      later(),
    );
    expect(edited.ok && edited.value.suggestions.map((kept) => kept.id)).toStrictEqual([
      second?.id,
      newId(1),
      newId(2),
      newId(3),
    ]);
    expect(first?.id).not.toBe(newId(1));
  });

  test('validates the result', ({ expect }) => {
    expect(editUraItem(createTestUraItem(), { title: '', body: '' }, later()).ok).toBe(false);
    expect(
      editUraItem(createTestUraItem(), { suggestions: [suggestion(1), suggestion(1)] }, later()).ok,
    ).toBe(false);
  });
});

function later(): UraEditContext {
  return { now: Temporal.Instant.from('2026-10-29T08:00:00.000Z'), deps: fixedUraDeps() };
}

/** The n-th id `fixedUraDeps` hands out. */
function newId(n: number): string {
  return testUraIds.itemId(n);
}

function suggestion(line: number): UraSuggestionDraft {
  return { path: 'src/app.ts', startLine: line, endLine: line, replacement: 'b' };
}
