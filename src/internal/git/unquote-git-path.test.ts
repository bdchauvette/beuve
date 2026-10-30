import { describe } from 'vitest';

import { unquoteGitPath } from './unquote-git-path.ts';
import { test } from './testing/test.ts';

describe('unquoteGitPath', () => {
  test('returns bare names unchanged', ({ expect }) => {
    expect(unquoteGitPath('a/new name ü.txt')).toBe('a/new name ü.txt');
  });

  test('decodes C escapes and octal UTF-8 bytes', ({ expect }) => {
    expect(unquoteGitPath(String.raw`"a/tab\there"`)).toBe('a/tab\there');
    expect(unquoteGitPath(String.raw`"q\"uote\\back\nline"`)).toBe('q"uote\\back\nline');
    expect(unquoteGitPath(String.raw`"\303\274ber"`)).toBe('über');
    expect(unquoteGitPath('"😀 ok"')).toBe('😀 ok');
  });

  test('rejects malformed quoting', ({ expect }) => {
    expect(unquoteGitPath('"unterminated')).toBeUndefined();
    expect(unquoteGitPath(String.raw`"bad \q escape"`)).toBeUndefined();
    expect(unquoteGitPath('"inner " quote"')).toBeUndefined();
    expect(unquoteGitPath('"')).toBeUndefined();
  });
});
