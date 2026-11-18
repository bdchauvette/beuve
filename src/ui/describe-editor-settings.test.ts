import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { EditorSettingsView } from '#contract/ipc-contract.ts';

import { describeEditorSettings } from './describe-editor-settings.ts';

function settings(): EditorSettingsView {
  return {
    editors: [
      {
        id: 'zed',
        name: 'Zed',
        installed: true,
        origin: 'built-in',
        found: { kind: 'cli', path: '/usr/bin/zed' },
      },
      { id: 'gram', name: 'Gram', installed: false, origin: 'built-in' },
      {
        id: 'helix',
        name: 'Helix',
        installed: true,
        origin: 'custom',
        found: { kind: 'cli', path: '/usr/bin/hx' },
      },
    ],
    problems: [],
    reviewEditsPrefix: 'review/',
  };
}

describe('describeEditorSettings', () => {
  test('says what is preferred and lists every editor by its id', ({ expect }) => {
    expect(describeEditorSettings({ ...settings(), preferred: 'gram' })).toStrictEqual([
      'Preferred editor: Gram (not found on this machine).',
      'Editors: zed (Zed), gram (Gram, not found), helix (Helix).',
    ]);
    expect(describeEditorSettings({ ...settings(), preferred: 'helix', current: 'helix' })[0]).toBe(
      'Preferred editor: Helix.',
    );
  });

  test('says what happens without a choice', ({ expect }) => {
    expect(describeEditorSettings(settings())[0]).toBe(
      'No editor chosen. Choose one in Review › Open With.',
    );
    expect(describeEditorSettings({ ...settings(), current: 'zed' })[0]).toBe(
      'No editor chosen: Open in Editor uses Zed, the only one found.',
    );
  });

  test('names a choice settings.json no longer defines, and its problems', ({ expect }) => {
    const lines = describeEditorSettings({
      ...settings(),
      preferred: 'emacs',
      problems: ['editors.vim: a new editor needs a "command"'],
    });
    expect(lines[0]).toContain('“emacs”, which settings.json no longer defines');
    expect(lines[2]).toBe('settings.json: editors.vim: a new editor needs a "command".');
  });

  test('handles no editors at all', ({ expect }) => {
    const lines = describeEditorSettings({ ...settings(), editors: [] });
    expect(lines[1]).toBe('No editors are configured.');
  });
});
