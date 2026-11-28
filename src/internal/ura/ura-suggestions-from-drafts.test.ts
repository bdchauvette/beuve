import { describe } from 'vitest';

import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import type { UraSuggestion } from './ura-item.ts';
import { uraSuggestionsFromDrafts } from './ura-suggestions-from-drafts.ts';

describe('uraSuggestionsFromDrafts', () => {
  test('keeps an existing id once, and gives every other draft a fresh one', ({ expect, deps }) => {
    const existing: UraSuggestion = {
      id: testUraIds.suggestionId(1),
      path: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      replacement: 'old',
    };
    const drafts = [
      { path: 'src/a.ts', startLine: 2, endLine: 2, replacement: 'moved', id: existing.id },
      { path: 'src/a.ts', startLine: 4, endLine: 4, replacement: 'again', id: existing.id },
      { path: 'src/a.ts', startLine: 6, endLine: 6, replacement: 'new' },
    ];
    expect(uraSuggestionsFromDrafts({ drafts, existing: [existing] }, deps)).toStrictEqual([
      { ...drafts[0], id: existing.id },
      { ...drafts[1], id: testUraIds.itemId(1) },
      { ...drafts[2], id: testUraIds.itemId(2) },
    ]);
    expect(
      uraSuggestionsFromDrafts({ drafts: [drafts[0] ?? existing], existing: [] }, deps)[0]?.id,
    ).toBe(testUraIds.itemId(3));
  });
});
