import { describe } from 'vitest';

import { chooseEditorRoot } from './choose-editor-root.ts';
import { test } from '../testing/test.ts';

function head(): string {
  return 'a'.repeat(40);
}

describe('chooseEditorRoot', () => {
  test('uses the working tree only at the session head with a clean file', ({ expect }) => {
    expect(
      chooseEditorRoot({ workingTreeHead: head(), sessionHead: head(), workingFile: 'clean' }),
    ).toBe('working-tree');
  });

  test('uses the beuve checkout when the working tree is on another commit', ({ expect }) => {
    expect(
      chooseEditorRoot({
        workingTreeHead: 'b'.repeat(40),
        sessionHead: head(),
        workingFile: 'clean',
      }),
    ).toBe('beuve-checkout');
    expect(
      chooseEditorRoot({ workingTreeHead: undefined, sessionHead: head(), workingFile: 'clean' }),
    ).toBe('beuve-checkout');
  });

  test('uses the beuve checkout when the file is modified or missing', ({ expect }) => {
    for (const workingFile of ['modified', 'missing'] as const) {
      expect(chooseEditorRoot({ workingTreeHead: head(), sessionHead: head(), workingFile })).toBe(
        'beuve-checkout',
      );
    }
  });
});
