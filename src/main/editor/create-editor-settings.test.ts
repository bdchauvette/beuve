import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { createEditorSettings } from './create-editor-settings.ts';
import { test } from '../testing/test.ts';

describe('createEditorSettings', () => {
  test('persists the choice in a JSON file and keeps other keys', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'nested', 'settings.json');
    const settings = createEditorSettings(file);
    await expect(settings.readEditorConfig()).resolves.toStrictEqual({
      preferred: undefined,
      editors: undefined,
    });
    await settings.write('cursor');
    await expect(createEditorSettings(file).readEditorConfig()).resolves.toMatchObject({
      preferred: 'cursor',
    });
    const editors = { helix: { command: 'hx' } };
    writeFileSync(file, JSON.stringify({ other: 1, editors, preferredEditor: 'cursor' }));
    await settings.write('helix');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      other: 1,
      editors,
      preferredEditor: 'helix',
    });
    await expect(settings.readEditorConfig()).resolves.toStrictEqual({
      preferred: 'helix',
      editors,
    });
    expect(settings.filePath).toBe(file);
  });

  test('reads garbage and ill-formed ids as unset', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, '{not json');
    await expect(createEditorSettings(file).readEditorConfig()).resolves.toStrictEqual({
      preferred: undefined,
      editors: undefined,
    });
    writeFileSync(file, JSON.stringify({ preferredEditor: 'Not An Id', editors: 3 }));
    await expect(createEditorSettings(file).readEditorConfig()).resolves.toStrictEqual({
      preferred: undefined,
      editors: 3,
    });
  });

  test('remembers in memory without a path', async ({ expect }) => {
    const settings = createEditorSettings();
    await settings.write('vscode');
    await expect(settings.readEditorConfig()).resolves.toStrictEqual({
      preferred: 'vscode',
      editors: undefined,
    });
    expect(settings.filePath).toBeUndefined();
  });
});
