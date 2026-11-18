import { describe } from 'vitest';

import { editorDefinitions } from './editor-definitions.ts';
import type { EditorDefinition } from './editor-definitions.ts';
import { getEditorDefinition } from './testing/get-editor-definition.ts';
import { findEditor } from './find-editor.ts';
import type { EditorProbe } from './find-editor.ts';
import { test } from '../testing/test.ts';

function fakeProbe(
  files: readonly string[],
  overrides: Partial<Pick<EditorProbe, 'platform' | 'env'>> = {},
): EditorProbe {
  const present = new Set(files);
  return {
    platform: 'linux',
    env: { PATH: '/usr/bin:/home/me/bin:relative', HOME: '/home/me' },
    exists: (file): boolean => {
      return present.has(file);
    },
    ...overrides,
  };
}

describe('editorDefinitions', () => {
  test('lists Zed, Gram, VS Code and Cursor', ({ expect }) => {
    expect(editorDefinitions.map(({ id }) => id)).toStrictEqual([
      'zed',
      'gram',
      'vscode',
      'cursor',
    ]);
  });
});

describe('findEditor', () => {
  test('finds a CLI on PATH, ignoring relative PATH entries', ({ expect }) => {
    expect(findEditor(getEditorDefinition('zed'), fakeProbe(['/home/me/bin/zed']))).toStrictEqual({
      kind: 'cli',
      command: '/home/me/bin/zed',
    });
    expect(findEditor(getEditorDefinition('zed'), fakeProbe(['relative/zed']))).toBeUndefined();
  });

  test('finds the distro name zeditor', ({ expect }) => {
    expect(findEditor(getEditorDefinition('zed'), fakeProbe(['/usr/bin/zeditor']))).toStrictEqual({
      kind: 'cli',
      command: '/usr/bin/zeditor',
    });
  });

  test('looks in well-known places when a GUI app has no PATH', ({ expect }) => {
    const mac = { platform: 'darwin', env: { HOME: '/Users/me' } };
    expect(
      findEditor(getEditorDefinition('zed'), fakeProbe(['/opt/homebrew/bin/zed'], mac)),
    ).toStrictEqual({
      kind: 'cli',
      command: '/opt/homebrew/bin/zed',
    });
    expect(
      findEditor(getEditorDefinition('zed'), fakeProbe(['/Users/me/.local/bin/zed'], mac)),
    ).toStrictEqual({
      kind: 'cli',
      command: '/Users/me/.local/bin/zed',
    });
    expect(
      findEditor(
        getEditorDefinition('zed'),
        fakeProbe(['/Applications/Zed.app/Contents/MacOS/cli'], mac),
      ),
    ).toStrictEqual({
      kind: 'cli',
      command: '/Applications/Zed.app/Contents/MacOS/cli',
    });
  });

  test('falls back to the URL scheme when only the macOS app bundle exists', ({ expect }) => {
    const mac = { platform: 'darwin', env: { HOME: '/Users/me' } };
    expect(
      findEditor(getEditorDefinition('cursor'), fakeProbe(['/Applications/Cursor.app'], mac)),
    ).toStrictEqual({
      kind: 'url',
      bundle: '/Applications/Cursor.app',
      scheme: 'cursor',
    });
    expect(
      findEditor(getEditorDefinition('cursor'), fakeProbe(['/Applications/Cursor.app'])),
    ).toBeUndefined();
  });

  test("finds Gram's CLI inside its app bundle, then its app", ({ expect }) => {
    const mac = { platform: 'darwin', env: { HOME: '/Users/me' } };
    expect(
      findEditor(
        getEditorDefinition('gram'),
        fakeProbe(['/Applications/Gram.app/Contents/MacOS/cli', '/Applications/Gram.app'], mac),
      ),
    ).toStrictEqual({ kind: 'cli', command: '/Applications/Gram.app/Contents/MacOS/cli' });
    expect(
      findEditor(getEditorDefinition('gram'), fakeProbe(['/Users/me/Applications/Gram.app'], mac)),
    ).toStrictEqual({ kind: 'url', bundle: '/Users/me/Applications/Gram.app', scheme: 'gram' });
  });

  test('never opens an editor without a URL scheme by its app bundle', ({ expect }) => {
    const mac = { platform: 'darwin', env: { HOME: '/Users/me' } };
    const withoutScheme: EditorDefinition = {
      id: 'zed',
      name: 'Zed',
      executables: [],
      knownPaths: ['/opt/zed/bin/zed'],
      appBundles: ['/Applications/Zed.app'],
      args: ['{file}:{line}:{column}'],
      origin: 'custom',
    };
    expect(findEditor(withoutScheme, fakeProbe(['/Applications/Zed.app'], mac))).toBeUndefined();
    expect(findEditor(withoutScheme, fakeProbe(['/opt/zed/bin/zed'], mac))).toStrictEqual({
      kind: 'cli',
      command: '/opt/zed/bin/zed',
    });
  });

  test('finds nothing without the editor, and nothing on Windows', ({ expect }) => {
    expect(findEditor(getEditorDefinition('vscode'), fakeProbe(['/usr/bin/zed']))).toBeUndefined();
    expect(
      findEditor(
        getEditorDefinition('vscode'),
        fakeProbe(['/usr/bin/code'], { platform: 'win32' }),
      ),
    ).toBeUndefined();
  });
});
