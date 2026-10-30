import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { createEditorSettings } from './create-editor-settings.ts';
import { test } from '../testing/test.ts';

describe('createEditorSettings', () => {
  test('persists the choice in a JSON file and keeps other keys', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'nested', 'settings.json');
    const settings = createEditorSettings(file);
    await expect(settings.read()).resolves.toBeUndefined();
    await settings.write('cursor');
    await expect(createEditorSettings(file).read()).resolves.toBe('cursor');
    writeFileSync(file, JSON.stringify({ other: 1, preferredEditor: 'cursor' }));
    await settings.write('zed');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      other: 1,
      preferredEditor: 'zed',
    });
  });

  test('reads garbage and unknown editors as unset', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, '{not json');
    await expect(createEditorSettings(file).read()).resolves.toBeUndefined();
    writeFileSync(file, JSON.stringify({ preferredEditor: 'emacs' }));
    await expect(createEditorSettings(file).read()).resolves.toBeUndefined();
  });

  test('remembers in memory without a path', async ({ expect }) => {
    const settings = createEditorSettings();
    await settings.write('vscode');
    await expect(settings.read()).resolves.toBe('vscode');
  });
});
