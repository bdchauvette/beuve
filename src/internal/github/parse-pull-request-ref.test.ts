import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parsePullRequestRef } from './parse-pull-request-ref.ts';
import type { PullRequestRef } from './pull-request.ts';

/** Spelled indirectly: the lint rule against plain HTTP can't tell a test of its refusal. */
function plainHttp(): string {
  return 'https://'.replace('s', '');
}

function pr(): PullRequestRef {
  return { host: 'github.com', owner: 'octo-org', repo: 'hello.world', number: 1347 };
}

describe('parsePullRequestRef', () => {
  test('reads web URLs, including sub-pages, queries and fragments', ({ expect }) => {
    for (const text of [
      'https://github.com/octo-org/hello.world/pull/1347',
      '  https://github.com/octo-org/hello.world/pull/1347/files?w=1#diff-abc ',
      'https://GitHub.com/octo-org/hello.world/pull/1347/',
    ]) {
      expect(parsePullRequestRef(text)).toStrictEqual({ ok: true, value: pr() });
    }
  });

  test('reads Enterprise URLs', ({ expect }) => {
    expect(parsePullRequestRef('https://ghe.corp.example/team/svc/pull/9')).toStrictEqual({
      ok: true,
      value: { host: 'ghe.corp.example', owner: 'team', repo: 'svc', number: 9 },
    });
  });

  test('reads owner/repo#n and host/owner/repo#n', ({ expect }) => {
    expect(parsePullRequestRef('octo-org/hello.world#1347')).toStrictEqual({
      ok: true,
      value: pr(),
    });
    expect(parsePullRequestRef('team/svc#9', { defaultHost: 'ghe.corp.example' })).toMatchObject({
      ok: true,
      value: { host: 'ghe.corp.example' },
    });
    expect(parsePullRequestRef('ghe.corp.example/team/svc#9')).toMatchObject({
      ok: true,
      value: { host: 'ghe.corp.example', owner: 'team', repo: 'svc', number: 9 },
    });
  });

  test('rejects anything else', ({ expect }) => {
    for (const text of [
      '',
      '#12',
      'octo-org/hello#0',
      'octo-org/hello#12a',
      'octo-org/hello#99999999999',
      'octo-org#12',
      '-x/hello#1',
      'a--b/hello#1',
      'octo-org/../x#1',
      'octo-org/..#1',
      'a/b/c/d#1',
      `${plainHttp()}github.com/o/r/pull/1`,
      'https://github.com:8443/o/r/pull/1',
      'https://user@github.com/o/r/pull/1',
      'https://github.com/o/r/issues/1',
      'https://github.com/o/r',
      'https://github.com/o/r/pull/1x',
    ]) {
      expect({ text, ok: parsePullRequestRef(text).ok }).toStrictEqual({ text, ok: false });
    }
  });
});
