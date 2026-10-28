import { describe, expect, it } from 'vitest';

import { editorDefinitions } from './editor-definitions.ts';
import { getEditorDefinition } from './testing/get-editor-definition.ts';
import { findEditor } from './find-editor.ts';
import type { EditorProbe } from './find-editor.ts';

const zed = getEditorDefinition('zed');
const vscode = getEditorDefinition('vscode');
const cursor = getEditorDefinition('cursor');

function fakeProbe(
  files: readonly string[],
  overrides: Partial<Pick<EditorProbe, 'platform' | 'env'>> = {},
): EditorProbe {
  const present = new Set(files);
  return {
    platform: 'linux',
    env: { PATH: '/usr/bin:/home/me/bin:relative', HOME: '/home/me' },
    exists: (file) => present.has(file),
    ...overrides,
  };
}

describe('editorDefinitions', () => {
  it('prefers Zed, then VS Code, then Cursor', () => {
    expect(editorDefinitions.map(({ id }) => id)).toEqual(['zed', 'vscode', 'cursor']);
  });
});

describe('findEditor', () => {
  it('finds a CLI on PATH, ignoring relative PATH entries', () => {
    expect(findEditor(zed, fakeProbe(['/home/me/bin/zed']))).toEqual({
      kind: 'cli',
      command: '/home/me/bin/zed',
    });
    expect(findEditor(zed, fakeProbe(['relative/zed']))).toBeUndefined();
  });

  it('finds the distro name zeditor', () => {
    expect(findEditor(zed, fakeProbe(['/usr/bin/zeditor']))).toEqual({
      kind: 'cli',
      command: '/usr/bin/zeditor',
    });
  });

  it('looks in well-known places when a GUI app has no PATH', () => {
    const mac = { platform: 'darwin', env: { HOME: '/Users/me' } };
    expect(findEditor(zed, fakeProbe(['/opt/homebrew/bin/zed'], mac))).toEqual({
      kind: 'cli',
      command: '/opt/homebrew/bin/zed',
    });
    expect(findEditor(zed, fakeProbe(['/Users/me/.local/bin/zed'], mac))).toEqual({
      kind: 'cli',
      command: '/Users/me/.local/bin/zed',
    });
    expect(findEditor(zed, fakeProbe(['/Applications/Zed.app/Contents/MacOS/cli'], mac))).toEqual({
      kind: 'cli',
      command: '/Applications/Zed.app/Contents/MacOS/cli',
    });
  });

  it('falls back to the URL scheme when only the macOS app bundle exists', () => {
    const mac = { platform: 'darwin', env: { HOME: '/Users/me' } };
    expect(findEditor(cursor, fakeProbe(['/Applications/Cursor.app'], mac))).toEqual({
      kind: 'url',
    });
    expect(findEditor(cursor, fakeProbe(['/Applications/Cursor.app']))).toBeUndefined();
  });

  it('finds nothing without the editor, and nothing on Windows', () => {
    expect(findEditor(vscode, fakeProbe(['/usr/bin/zed']))).toBeUndefined();
    expect(findEditor(vscode, fakeProbe(['/usr/bin/code'], { platform: 'win32' }))).toBeUndefined();
  });
});
