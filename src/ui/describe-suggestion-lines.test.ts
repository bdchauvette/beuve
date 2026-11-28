import { describe } from 'vitest';

import { describeSuggestionLines } from './describe-suggestion-lines.ts';
import { test } from './testing/test.ts';

describe('describeSuggestionLines', () => {
  test('heads a field with its path and lines, and names it in words', ({ expect }) => {
    expect(
      describeSuggestionLines({ path: 'src/retry.ts', startLine: 10, endLine: 12 }),
    ).toStrictEqual({
      heading: 'src/retry.ts:L10–12',
      name: 'Suggestion for src/retry.ts, lines 10 to 12',
    });
    expect(describeSuggestionLines({ path: 'a.ts', startLine: 7, endLine: 7 })).toStrictEqual({
      heading: 'a.ts:L7',
      name: 'Suggestion for a.ts, line 7',
    });
    expect(describeSuggestionLines({ path: 'a.ts', startLine: 7, endLine: 6 })).toStrictEqual({
      heading: 'a.ts:L7 (insert before)',
      name: 'Suggestion for a.ts, new lines before line 7',
    });
  });

  test('reveals hidden characters of the path in the name', ({ expect }) => {
    const { name } = describeSuggestionLines({ path: 'a\u{202E}b.ts', startLine: 1, endLine: 1 });
    expect(name).toBe('Suggestion for a⟨U+202E⟩b.ts, line 1');
  });
});
