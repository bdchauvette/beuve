import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseBranchRef } from './parse-branch-ref.ts';

describe('parseBranchRef', () => {
  test.for([
    ['https://github.com/octo-org/hello-world/tree/main', 'github.com', 'main'],
    [
      'https://github.com/octo-org/hello-world/tree/claude/fix-login',
      'github.com',
      'claude/fix-login',
    ],
    ['https://github.com/octo-org/hello-world/tree/claude/fix?x=1#top', 'github.com', 'claude/fix'],
    ['https://GitHub.com/octo-org/hello-world/tree/a%2Fb', 'github.com', 'a/b'],
    [
      'https://ghe.example.com/octo-org/hello-world/tree/release/2.x',
      'ghe.example.com',
      'release/2.x',
    ],
    ['octo-org/hello-world:claude/fix', 'github.com', 'claude/fix'],
    ['ghe.example.com/octo-org/hello-world:topic', 'ghe.example.com', 'topic'],
    ['  octo-org/hello-world:topic  ', 'github.com', 'topic'],
  ] as const)('reads %s', ([text, host, branch], { expect }) => {
    expect(parseBranchRef(text)).toStrictEqual({
      ok: true,
      value: { host, owner: 'octo-org', repo: 'hello-world', branch },
    });
  });

  test('puts the shorthand on the default host', ({ expect }) => {
    expect(parseBranchRef('o/r:b', { defaultHost: 'ghe.example.com' })).toMatchObject({
      ok: true,
      value: { host: 'ghe.example.com' },
    });
  });

  test.for([
    ['a pull request URL', 'https://github.com/o/r/pull/3'],
    ['a tree URL without a branch', 'https://github.com/o/r/tree/'],
    ['another scheme', 'ftp://github.com/o/r/tree/main'],
    ['a port', 'https://github.com:8443/o/r/tree/main'],
    ['credentials', 'https://user@github.com/o/r/tree/main'],
    ['no branch', 'o/r'],
    ['an empty branch', 'o/r:'],
    ['an unsafe branch', 'o/r:-rf'],
    ['a branch with spaces', 'o/r:a b'],
    ['a bad owner', 'o_o/r:main'],
    ['a dot repository', 'o/..:main'],
    ['too many segments', 'a/b/c/d:main'],
    ['a bad escape', 'https://github.com/o/r/tree/%E0%A4%A'],
  ] as const)('refuses %s', ([, text], { expect }) => {
    expect(parseBranchRef(text)).toMatchObject({ ok: false });
  });
});
