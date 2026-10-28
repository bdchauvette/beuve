import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEditorSettings } from './create-editor-settings.ts';

describe('createEditorSettings', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-settings-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists the choice in a JSON file and keeps other keys', async () => {
    const file = path.join(directory, 'nested', 'settings.json');
    const settings = createEditorSettings(file);
    expect(await settings.read()).toBeUndefined();
    await settings.write('cursor');
    expect(await createEditorSettings(file).read()).toBe('cursor');
    writeFileSync(file, JSON.stringify({ other: 1, preferredEditor: 'cursor' }));
    await settings.write('zed');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ other: 1, preferredEditor: 'zed' });
  });

  it('reads garbage and unknown editors as unset', async () => {
    const file = path.join(directory, 'settings.json');
    writeFileSync(file, '{not json');
    expect(await createEditorSettings(file).read()).toBeUndefined();
    writeFileSync(file, JSON.stringify({ preferredEditor: 'emacs' }));
    expect(await createEditorSettings(file).read()).toBeUndefined();
  });

  it('remembers in memory without a path', async () => {
    const settings = createEditorSettings();
    await settings.write('vscode');
    expect(await settings.read()).toBe('vscode');
  });
});
