import { describe } from 'vitest';

import { buildEditorUrl } from './build-editor-url.ts';
import { isEditorUrl } from './is-editor-url.ts';
import { test } from '../testing/test.ts';

describe('buildEditorUrl', () => {
  test('builds the Zed file URL', ({ expect }) => {
    expect(buildEditorUrl('zed', '/repo/src/a.ts', 12, 3)).toBe('zed://file/repo/src/a.ts:12:3');
  });

  test('builds the VS Code and Cursor file URLs', ({ expect }) => {
    expect(buildEditorUrl('vscode', '/r/a.ts', 1, 1)).toBe('vscode://file/r/a.ts:1:1');
    expect(buildEditorUrl('cursor', '/r/a.ts', 1, 1)).toBe('cursor://file/r/a.ts:1:1');
  });

  test('percent-encodes characters that would change the URL', ({ expect }) => {
    const url = buildEditorUrl('zed', '/my repo/a#b?c.ts', 2, 1);
    expect(url).toBe('zed://file/my%20repo/a%23b%3Fc.ts:2:1');
    expect(isEditorUrl(url)).toBe(true);
  });
});

describe('isEditorUrl', () => {
  test('accepts only editor file URLs', ({ expect }) => {
    expect(isEditorUrl('zed://file/a/b.ts:1:1')).toBe(true);
    expect(isEditorUrl('vscode://file/a/b.ts:1:1')).toBe(true);
    expect(isEditorUrl('cursor://file/a/b.ts:1:1')).toBe(true);
  });

  test('refuses everything else', ({ expect }) => {
    for (const url of [
      'https://example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'zed://settings',
      'vscode://vscode.git/clone?url=x',
      'zed://file/a?x=1',
      'zed://user@file/a',
      'ssh://file/a',
      'not a url',
      '',
    ]) {
      expect(isEditorUrl(url)).toBe(false);
    }
  });
});
