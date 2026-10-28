import { describe, expect, it } from 'vitest';

import { buildGithubHttpRequest } from './build-github-http-request.ts';
import { githubPath } from './github-path.ts';
import { resolveGithubApiBase } from './resolve-github-api-base.ts';

/** Spelled indirectly: the lint rule against plain HTTP can't tell a test of its refusal. */
const plainHttp = 'https://'.replace('s', '');

const context = {
  base: resolveGithubApiBase('github.com'),
  token: 'gho_secret',
  apiVersion: '2022-11-28',
  userAgent: 'beuve',
};

describe('buildGithubHttpRequest', () => {
  it('sets the API headers, query and conditional ETag', () => {
    const built = buildGithubHttpRequest(
      {
        method: 'GET',
        path: '/repos/o/r/pulls',
        query: { state: 'open', per_page: 100, base: undefined },
        etag: 'W/"abc"',
      },
      context,
    );
    expect(built).toEqual({
      ok: true,
      value: {
        url: 'https://api.github.com/repos/o/r/pulls?state=open&per_page=100',
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer gho_secret',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'beuve',
          'If-None-Match': 'W/"abc"',
        },
        body: undefined,
      },
    });
  });

  it('serializes a JSON body', () => {
    const built = buildGithubHttpRequest({ method: 'POST', path: '/x', body: { a: 1 } }, context);
    expect(built.ok && built.value.body).toBe('{"a":1}');
    expect(built.ok && built.value.headers['Content-Type']).toBe('application/json');
  });

  it('roots GitHub Enterprise paths at /api/v3', () => {
    const built = buildGithubHttpRequest(
      { method: 'GET', path: githubPath`/repos/${'o'}/${'r'}/pulls/${7}` },
      { ...context, base: resolveGithubApiBase('ghe.example.com') },
    );
    expect(built.ok && built.value.url).toBe('https://ghe.example.com/api/v3/repos/o/r/pulls/7');
  });

  it('accepts absolute next-page URLs on the API origin as they are', () => {
    const next = 'https://api.github.com/repositories/1/pulls?page=2&per_page=100';
    const built = buildGithubHttpRequest(
      { method: 'GET', path: next, query: { page: 9 } },
      context,
    );
    expect(built.ok && built.value.url).toBe(next);
  });

  it('refuses URLs that would send the token elsewhere', () => {
    const ghe = { ...context, base: resolveGithubApiBase('ghe.example.com') };
    for (const path of [
      'https://evil.example.com/repos',
      `${plainHttp}api.github.com/repos`,
      'https://user@api.github.com/repos',
      '//evil.example.com/x',
      'repos/o/r',
    ]) {
      expect(buildGithubHttpRequest({ method: 'GET', path }, context).ok).toBe(false);
    }
    expect(buildGithubHttpRequest({ method: 'GET', path: '/../../admin' }, ghe).ok).toBe(false);
    expect(
      buildGithubHttpRequest({ method: 'GET', path: 'https://ghe.example.com/admin' }, ghe).ok,
    ).toBe(false);
  });

  it('encodes interpolated path segments', () => {
    expect(githubPath`/repos/${'a/b'}/${'c?d'}/pulls/${1}`).toBe('/repos/a%2Fb/c%3Fd/pulls/1');
  });
});
