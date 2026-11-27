import { describe } from 'vitest';

import { editedPatchFrom } from './edited-patch-from.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('editedPatchFrom', () => {
  test('re-edits from the one suggestion on the note’s own path', ({ expect }) => {
    const own = { path: 'src/a.ts', startLine: 3, endLine: 4, replacement: 'x', patch: 'p\n' };
    expect(editedPatchFrom(createUraItemView({ suggestions: [own] }))).toBe('p\n');
    expect(
      editedPatchFrom(createUraItemView({ suggestions: [{ ...own, path: 'lib/b.ts' }] })),
    ).toBeUndefined();
    expect(
      editedPatchFrom(
        createUraItemView({ suggestions: [own, { ...own, startLine: 9, endLine: 9 }] }),
      ),
    ).toBeUndefined();
    expect(editedPatchFrom(createUraItemView())).toBeUndefined();
  });
});
