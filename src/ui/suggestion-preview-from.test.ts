import { describe } from 'vitest';

import { suggestionPreviewFrom } from './suggestion-preview-from.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('suggestionPreviewFrom', () => {
  test('joins the derived patches, and shows a suggestion without one as its new lines', ({
    expect,
  }) => {
    const item = createUraItemView({
      suggestions: [
        { path: 'src/a.ts', startLine: 3, endLine: 3, replacement: 'x', patch: 'first\n' },
        { path: 'lib/b.ts', startLine: 2, endLine: 1, replacement: 'one\ntwo' },
        { path: 'lib/b.ts', startLine: 9, endLine: 9, replacement: '' },
      ],
    });
    expect(suggestionPreviewFrom(item)).toBe(
      [
        'first',
        '--- a/lib/b.ts',
        '+++ b/lib/b.ts',
        '@@ lines 2–1 @@',
        '+one',
        '+two',
        '--- a/lib/b.ts',
        '+++ b/lib/b.ts',
        '@@ lines 9–9 @@',
        '',
      ].join('\n'),
    );
  });

  test('has nothing for a note without suggestions', ({ expect }) => {
    expect(suggestionPreviewFrom(createUraItemView())).toBeUndefined();
  });
});
