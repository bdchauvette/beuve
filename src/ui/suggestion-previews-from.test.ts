import { describe } from 'vitest';

import { splitPatch } from './split-patch.ts';
import { suggestionPreviewsFrom } from './suggestion-previews-from.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

function patch(line: number, text: string): string {
  return `--- a/src/a.ts\n+++ b/src/a.ts\n@@ -${String(line)} +${String(line)} @@\n-old\n+${text}\n`;
}

describe('suggestionPreviewsFrom', () => {
  test('previews each suggestion on its own, headed by its lines unless they are the note’s', ({
    expect,
  }) => {
    const item = createUraItemView({
      suggestions: [
        { path: 'src/a.ts', startLine: 3, endLine: 4, replacement: 'x', patch: 'first\n' },
        { path: 'lib/b.ts', startLine: 2, endLine: 1, replacement: 'one\ntwo' },
        { path: 'lib/b.ts', startLine: 9, endLine: 9, replacement: '' },
      ],
    });
    expect(suggestionPreviewsFrom(item)).toStrictEqual([
      { id: expect.any(String) as unknown, patch: 'first\n' },
      {
        id: expect.any(String) as unknown,
        heading: 'lib/b.ts:L2 (insert before)',
        patch: '--- a/lib/b.ts\n+++ b/lib/b.ts\n@@ lines 2–1 @@\n+one\n+two\n',
      },
      {
        id: expect.any(String) as unknown,
        heading: 'lib/b.ts:L9',
        patch: '--- a/lib/b.ts\n+++ b/lib/b.ts\n@@ lines 9–9 @@\n',
      },
    ]);
  });

  test('two derived patches of one file never read as one: no header lands inside a hunk', ({
    expect,
  }) => {
    const item = createUraItemView({
      suggestions: [
        { path: 'src/a.ts', startLine: 3, endLine: 4, replacement: 'a', patch: patch(3, 'a') },
        { path: 'src/a.ts', startLine: 1, endLine: 1, replacement: 'b', patch: patch(1, 'b') },
      ],
    });
    const changed = suggestionPreviewsFrom(item).map((preview) => {
      return splitPatch(preview.patch)
        .filter((line) => line.kind === 'added' || line.kind === 'removed')
        .map((line) => line.text);
    });
    expect(changed).toStrictEqual([
      ['-old', '+a'],
      ['-old', '+b'],
    ]);
  });

  test('has nothing for a note without suggestions', ({ expect }) => {
    expect(suggestionPreviewsFrom(createUraItemView())).toStrictEqual([]);
  });
});
