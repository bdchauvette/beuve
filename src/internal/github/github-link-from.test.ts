import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { githubLinkFrom } from './github-link-from.ts';

function linkTo(target: string): string {
  return `beuve://open?url=${encodeURIComponent(target)}`;
}

describe('githubLinkFrom', () => {
  test('reads a pull request URL, with sub-pages and fragments', ({ expect }) => {
    for (const target of [
      'https://github.com/octo-org/hello.world/pull/1347',
      'https://github.com/octo-org/hello.world/pull/1347/files?w=1#diff-abc',
    ]) {
      expect(githubLinkFrom(linkTo(target))).toStrictEqual({
        ok: true,
        value: {
          kind: 'pull-request',
          ref: { host: 'github.com', owner: 'octo-org', repo: 'hello.world', number: 1347 },
          text: 'github.com/octo-org/hello.world#1347',
        },
      });
    }
  });

  test('keeps an Enterprise host in the text', ({ expect }) => {
    expect(githubLinkFrom(linkTo('https://ghe.corp.example/team/svc/pull/9'))).toMatchObject({
      ok: true,
      value: { text: 'ghe.corp.example/team/svc#9' },
    });
  });

  test('reads a link with an unencoded URL and a trailing slash', ({ expect }) => {
    expect(githubLinkFrom('beuve://open/?url=https://github.com/o/r/pull/3')).toMatchObject({
      ok: true,
      value: { text: 'github.com/o/r#3' },
    });
  });

  test('reads a tree URL as a branch to follow (ADR 0112)', ({ expect }) => {
    expect(
      githubLinkFrom(linkTo('https://github.com/octo-org/hello-world/tree/claude/fix-login')),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'branch',
        ref: {
          host: 'github.com',
          owner: 'octo-org',
          repo: 'hello-world',
          branch: 'claude/fix-login',
        },
        text: 'github.com/octo-org/hello-world:claude/fix-login',
      },
    });
  });

  test.for([
    ['another scheme', 'https://github.com/o/r/pull/3'],
    ['not a URL', 'beuve'],
    [
      'an unknown action',
      `beuve://clone?url=${encodeURIComponent('https://github.com/o/r/pull/3')}`,
    ],
    ['no url parameter', 'beuve://open'],
    [
      'a repeated url parameter',
      'beuve://open?url=https://github.com/o/r/pull/3&url=https://github.com/o/r/pull/4',
    ],
    ['the shorthand', linkTo('o/r#3')],
    ['a file URL', linkTo('file:///etc/passwd')],
    ['a commit URL', linkTo('https://github.com/o/r/commit/abc')],
    ['credentials in the URL', linkTo('https://user@github.com/o/r/pull/3')],
    ['the branch shorthand', linkTo('o/r:main')],
    ['an unsafe branch', linkTo('https://github.com/o/r/tree/a..b')],
    ['a tree URL on another scheme', linkTo('ftp://github.com/o/r/tree/main')],
    ['a link with credentials', 'beuve://user@open?url=https://github.com/o/r/pull/3'],
  ] as const)('refuses %s', ([, link], { expect }) => {
    expect(githubLinkFrom(link)).toMatchObject({ ok: false });
  });
});
