import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { EditorSettingsView } from '#contract/ipc-contract.ts';

import { currentEditorName } from './current-editor-name.ts';

function settings(): EditorSettingsView {
  return {
    preferred: 'cursor',
    editors: [
      { id: 'zed', name: 'Zed', installed: true },
      { id: 'vscode', name: 'VS Code', installed: true },
      { id: 'cursor', name: 'Cursor', installed: false },
    ],
    reviewEditsPrefix: 'review/',
  };
}

describe('currentEditorName', () => {
  test('uses the preferred editor only when installed, else the first installed', ({ expect }) => {
    expect(currentEditorName(settings())).toBe('Zed');
    expect(currentEditorName({ ...settings(), preferred: 'vscode' })).toBe('VS Code');
    expect(currentEditorName(undefined)).toBe('');
  });
});
