import { describe, expect, it } from 'vitest';

import type { EditorSettingsView } from '#contract/ipc-contract.ts';

import { currentEditorName } from './current-editor-name.ts';

const settings: EditorSettingsView = {
  preferred: 'cursor',
  editors: [
    { id: 'zed', name: 'Zed', installed: true },
    { id: 'vscode', name: 'VS Code', installed: true },
    { id: 'cursor', name: 'Cursor', installed: false },
  ],
};

describe('currentEditorName', () => {
  it('uses the preferred editor only when installed, else the first installed', () => {
    expect(currentEditorName(settings)).toBe('Zed');
    expect(currentEditorName({ ...settings, preferred: 'vscode' })).toBe('VS Code');
    expect(currentEditorName(undefined)).toBe('');
  });
});
