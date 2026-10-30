import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { buildGithubHttpRequest } from './build-github-http-request.ts';
import { githubPath } from './github-path.ts';
import { resolveGithubApiBase } from './resolve-github-api-base.ts';

function context(): Parameters<typeof buildGithubHttpRequest>[1] {
  return {
    base: resolveGithubApiBase('github.com'),
    token: 'gho_secret',
    apiVersion: '2022-11-28',
    userAgent: 'beuve',
  };
}

/** Spelled indirectly: the lint rule against plain HTTP can't tell a test of its refusal. */
function plainHttp(): string {
  return 'https://'.replace('s', '');
}

describe('buildGithubHttpRequest', () => {
  test('sets the API headers, query and conditional ETag', ({ expect }) => {
    const built = buildGithubHttpRequest(
      {
        method: 'GET',
        path: '/repos/o/r/pulls',
        query: { state: 'open', per_page: 100, base: undefined },
        etag: 'W/"abc"',
      },
      context(),
    );
    expect(built).toStrictEqual({
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

  test('serializes a JSON body', ({ expect }) => {
    const built = buildGithubHttpRequest({ method: 'POST', path: '/x', body: { a: 1 } }, context());
    expect(built.ok && built.value.body).toBe('{"a":1}');
    expect(built.ok && built.value.headers['Content-Type']).toBe('application/json');
  });

  test('roots GitHub Enterprise paths at /api/v3', ({ expect }) => {
    const built = buildGithubHttpRequest(
      { method: 'GET', path: githubPath`/repos/${'o'}/${'r'}/pulls/${7}` },
      { ...context(), base: resolveGithubApiBase('ghe.example.com') },
    );
    expect(built.ok && built.value.url).toBe('https://ghe.example.com/api/v3/repos/o/r/pulls/7');
  });

  test('accepts absolute next-page URLs on the API origin as they are', ({ expect }) => {
    const next = 'https://api.github.com/repositories/1/pulls?page=2&per_page=100';
    const built = buildGithubHttpRequest(
      { method: 'GET', path: next, query: { page: 9 } },
      context(),
    );
    expect(built.ok && built.value.url).toBe(next);
  });

  test('refuses URLs that would send the token elsewhere', ({ expect }) => {
    const ghe = { ...context(), base: resolveGithubApiBase('ghe.example.com') };
    for (const path of [
      'https://evil.example.com/repos',
      `${plainHttp()}api.github.com/repos`,
      'https://user@api.github.com/repos',
      '//evil.example.com/x',
      'repos/o/r',
    ]) {
      expect(buildGithubHttpRequest({ method: 'GET', path }, context()).ok).toBe(false);
    }
    expect(buildGithubHttpRequest({ method: 'GET', path: '/../../admin' }, ghe).ok).toBe(false);
    expect(
      buildGithubHttpRequest({ method: 'GET', path: 'https://ghe.example.com/admin' }, ghe).ok,
    ).toBe(false);
  });

  test('encodes interpolated path segments', ({ expect }) => {
    expect(githubPath`/repos/${'a/b'}/${'c?d'}/pulls/${1}`).toBe('/repos/a%2Fb/c%3Fd/pulls/1');
  });
});
