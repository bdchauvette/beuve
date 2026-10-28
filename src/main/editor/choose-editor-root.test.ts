import { describe, expect, it } from 'vitest';

import { chooseEditorRoot } from './choose-editor-root.ts';

const head = 'a'.repeat(40);

describe('chooseEditorRoot', () => {
  it('uses the working tree only at the session head with a clean file', () => {
    expect(
      chooseEditorRoot({ workingTreeHead: head, sessionHead: head, workingFile: 'clean' }),
    ).toBe('working-tree');
  });

  it('uses the beuve checkout when the working tree is on another commit', () => {
    expect(
      chooseEditorRoot({
        workingTreeHead: 'b'.repeat(40),
        sessionHead: head,
        workingFile: 'clean',
      }),
    ).toBe('beuve-checkout');
    expect(
      chooseEditorRoot({ workingTreeHead: undefined, sessionHead: head, workingFile: 'clean' }),
    ).toBe('beuve-checkout');
  });

  it('uses the beuve checkout when the file is modified or missing', () => {
    for (const workingFile of ['modified', 'missing'] as const) {
      expect(chooseEditorRoot({ workingTreeHead: head, sessionHead: head, workingFile })).toBe(
        'beuve-checkout',
      );
    }
  });
});
