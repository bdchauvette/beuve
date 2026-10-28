import { describe, expect, it } from 'vitest';

import { parsePullRequestRef } from './parse-pull-request-ref.ts';

const plainHttp = 'https://'.replace('s', '');
const pr = { host: 'github.com', owner: 'octo-org', repo: 'hello.world', number: 1347 };

describe('parsePullRequestRef', () => {
  it('reads web URLs, including sub-pages, queries and fragments', () => {
    for (const text of [
      'https://github.com/octo-org/hello.world/pull/1347',
      '  https://github.com/octo-org/hello.world/pull/1347/files?w=1#diff-abc ',
      'https://GitHub.com/octo-org/hello.world/pull/1347/',
    ]) {
      expect(parsePullRequestRef(text)).toEqual({ ok: true, value: pr });
    }
  });

  it('reads Enterprise URLs', () => {
    expect(parsePullRequestRef('https://ghe.corp.example/team/svc/pull/9')).toEqual({
      ok: true,
      value: { host: 'ghe.corp.example', owner: 'team', repo: 'svc', number: 9 },
    });
  });

  it('reads owner/repo#n and host/owner/repo#n', () => {
    expect(parsePullRequestRef('octo-org/hello.world#1347')).toEqual({ ok: true, value: pr });
    expect(parsePullRequestRef('team/svc#9', 'ghe.corp.example')).toMatchObject({
      ok: true,
      value: { host: 'ghe.corp.example' },
    });
    expect(parsePullRequestRef('ghe.corp.example/team/svc#9')).toMatchObject({
      ok: true,
      value: { host: 'ghe.corp.example', owner: 'team', repo: 'svc', number: 9 },
    });
  });

  it('rejects anything else', () => {
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
      `${plainHttp}github.com/o/r/pull/1`,
      'https://github.com:8443/o/r/pull/1',
      'https://user@github.com/o/r/pull/1',
      'https://github.com/o/r/issues/1',
      'https://github.com/o/r',
      'https://github.com/o/r/pull/1x',
    ]) {
      expect(parsePullRequestRef(text).ok, text).toBe(false);
    }
  });
});
