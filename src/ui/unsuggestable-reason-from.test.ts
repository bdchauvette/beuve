import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { unsuggestableReasonFrom } from './unsuggestable-reason-from.ts';

describe('unsuggestableReasonFrom', () => {
  test('takes suggestions on added, modified and renamed files, with or without hunks', ({
    expect,
  }) => {
    const body = ['+one', '+two'];
    expect(unsuggestableReasonFrom(createDiffFileView('a.ts', body))).toBeUndefined();
    expect(
      unsuggestableReasonFrom(createDiffFileView('a.ts', body, { overrides: { status: 'added' } })),
    ).toBeUndefined();
    expect(
      unsuggestableReasonFrom(
        createDiffFileView('a.ts', [], { overrides: { status: 'renamed', oldPath: 'b.ts' } }),
      ),
    ).toBeUndefined();
  });

  test('says why a deleted or binary file has no lines to suggest on', ({ expect }) => {
    const file = createDiffFileView('a.ts', ['-one']);
    expect(unsuggestableReasonFrom({ ...file, status: 'deleted' })).toBe(
      'A deleted file has no head lines to suggest a change on.',
    );
    expect(unsuggestableReasonFrom({ ...file, binary: true, hunks: [] })).toBe(
      'A binary file has no lines to suggest a change on.',
    );
  });
});
