import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { uneditableReasonFrom } from './uneditable-reason-from.ts';

describe('uneditableReasonFrom', () => {
  test('edits added, modified and renamed files with hunks', ({ expect }) => {
    const body = ['+one', '+two'];
    expect(uneditableReasonFrom(createDiffFileView('a.ts', body))).toBeUndefined();
    expect(
      uneditableReasonFrom(createDiffFileView('a.ts', body, { overrides: { status: 'added' } })),
    ).toBeUndefined();
    expect(
      uneditableReasonFrom(
        createDiffFileView('a.ts', body, { overrides: { status: 'renamed', oldPath: 'b.ts' } }),
      ),
    ).toBeUndefined();
  });

  test('says why a deleted, binary or hunkless file has nothing to edit', ({ expect }) => {
    const file = createDiffFileView('a.ts', ['-one']);
    expect(uneditableReasonFrom({ ...file, status: 'deleted' })).toBe(
      'A deleted file has no head lines to suggest an edit on.',
    );
    expect(uneditableReasonFrom({ ...file, binary: true, hunks: [] })).toBe(
      'A binary file cannot be edited as text.',
    );
    expect(uneditableReasonFrom({ ...file, status: 'renamed', hunks: [] })).toBe(
      'This file has no changed lines to suggest an edit on.',
    );
  });
});
