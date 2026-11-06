import { describe } from 'vitest';

import { searchPullRequests } from './search-pull-requests.ts';
import { test } from './testing/test.ts';

function item(number: number, repositoryUrl: string): Record<string, unknown> {
  return {
    number,
    title: `Change ${String(number)}`,
    draft: number === 2,
    user: { login: 'octocat' },
    html_url: `https://github.com/o/r/pull/${String(number)}`,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    repository_url: repositoryUrl,
    pull_request: { url: 'x' },
  };
}

describe('searchPullRequests', () => {
  test('decodes pull requests, reads the repository from its API URL and drops issues', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        headers: { etag: '"s1"' },
        body: {
          total_count: 3,
          incomplete_results: false,
          items: [
            item(1, 'https://api.github.com/repos/octo-org/hello-world'),
            item(2, 'https://ghe.example/api/v3/repos/team/tools'),
            { ...item(3, 'https://api.github.com/repos/o/r'), pull_request: undefined },
          ],
        },
      };
    });
    const result = await searchPullRequests(client, 'is:open is:pr review-requested:@me', {
      signal,
    });
    expect(requests[0]?.url).toBe(
      'https://api.github.com/search/issues?q=is%3Aopen+is%3Apr+review-requested%3A%40me&sort=updated&order=desc&per_page=100',
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        kind: 'modified',
        etag: '"s1"',
        value: {
          isTruncated: false,
          hiddenOrganizations: 0,
          scopes: undefined,
          items: [
            {
              owner: 'octo-org',
              repo: 'hello-world',
              number: 1,
              title: 'Change 1',
              author: 'octocat',
              isDraft: false,
              htmlUrl: 'https://github.com/o/r/pull/1',
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-02T00:00:00Z',
            },
            expect.objectContaining({ owner: 'team', repo: 'tools', number: 2, isDraft: true }),
          ],
        },
      },
    });
  });

  test('answers not-modified for a matching ETag', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return { status: 304 };
    });
    await expect(
      searchPullRequests(client, 'is:pr', { etag: '"s1"', signal }),
    ).resolves.toStrictEqual({ ok: true, value: { kind: 'not-modified' } });
    expect(requests[0]?.headers).toMatchObject({ 'If-None-Match': '"s1"' });
  });

  test('reads at most maxPages pages and then reports truncation, without an ETag', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub((_request, index) => {
      return {
        status: 200,
        headers: {
          etag: '"p"',
          link: `<https://api.github.com/search/issues?q=x&page=${String(index + 2)}>; rel="next"`,
        },
        body: { items: [item(index + 1, 'https://api.github.com/repos/o/r')] },
      };
    });
    const result = await searchPullRequests(client, 'x', { maxPages: 2, signal });
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'modified',
        etag: undefined,
        value: { isTruncated: true, items: [{ number: 1 }, { number: 2 }] },
      },
    });
  });

  test('passes search rate limits through', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793000000' },
        body: { message: 'API rate limit exceeded' },
      };
    });
    await expect(searchPullRequests(client, 'x', { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rate-limited' },
    });
  });

  test('counts organizations SAML SSO hid and reads the classic token scopes', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 200,
        headers: {
          'x-github-sso': 'partial-results; organizations=21955855,20582480',
          'x-oauth-scopes': 'repo, gist',
        },
        body: { items: [] },
      };
    });
    await expect(searchPullRequests(client, 'x', { signal })).resolves.toMatchObject({
      ok: true,
      value: { value: { hiddenOrganizations: 2, scopes: ['repo', 'gist'] } },
    });
  });
});
