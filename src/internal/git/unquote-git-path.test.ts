import { describe, expect, it } from 'vitest';

import { unquoteGitPath } from './unquote-git-path.ts';

describe('unquoteGitPath', () => {
  it('returns bare names unchanged', () => {
    expect(unquoteGitPath('a/new name ü.txt')).toBe('a/new name ü.txt');
  });

  it('decodes C escapes and octal UTF-8 bytes', () => {
    expect(unquoteGitPath(String.raw`"a/tab\there"`)).toBe('a/tab\there');
    expect(unquoteGitPath(String.raw`"q\"uote\\back\nline"`)).toBe('q"uote\\back\nline');
    expect(unquoteGitPath(String.raw`"\303\274ber"`)).toBe('über');
    expect(unquoteGitPath('"😀 ok"')).toBe('😀 ok');
  });

  it('rejects malformed quoting', () => {
    expect(unquoteGitPath('"unterminated')).toBeUndefined();
    expect(unquoteGitPath(String.raw`"bad \q escape"`)).toBeUndefined();
    expect(unquoteGitPath('"inner " quote"')).toBeUndefined();
    expect(unquoteGitPath('"')).toBeUndefined();
  });
});
