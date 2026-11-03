import { describe } from 'vitest';

import type { FakeResponse, RecordedRequest } from './testing/create-fake-github.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';
import { getPullRequestTimeline } from './get-pull-request-timeline.ts';
import type { PullRequestRef } from './pull-request.ts';

function ref(): Omit<PullRequestRef, 'host'> {
  return { owner: 'octo-org', repo: 'hello-world', number: 7 };
}

function prefix(): string {
  return 'https://api.github.com/repos/octo-org/hello-world';
}

function noUser(): unknown {
  return JSON.parse('null') as unknown;
}

function respondTo(request: RecordedRequest): FakeResponse {
  if (request.url.startsWith(`${prefix()}/pulls/7/commits`)) {
    return {
      status: 200,
      body: [
        {
          sha: 'c1',
          html_url: 'https://github.com/octo-org/hello-world/commit/c1',
          commit: {
            message: 'Add a thing\n\nLonger text',
            author: { name: 'Ann', date: '2026-10-01T12:00:00+02:00' },
          },
          author: { login: 'ann' },
        },
        {
          sha: 'c2',
          html_url: 'u2',
          commit: { message: 'Fix it', author: { name: 'Bo', date: '2026-10-03T10:00:00Z' } },
          author: noUser(),
        },
      ],
    };
  }
  if (request.url.startsWith(`${prefix()}/pulls/7/reviews`)) {
    return {
      status: 200,
      body: [
        {
          user: { login: 'rita' },
          state: 'APPROVED',
          body: '',
          submitted_at: '2026-10-04T10:00:00Z',
          html_url: 'r1',
        },
        { user: { login: 'vic' }, state: 'PENDING', body: 'draft', html_url: 'r2' },
        {
          user: { login: 'vic' },
          state: 'COMMENTED',
          body: '  ',
          submitted_at: '2026-10-04T11:00:00Z',
          html_url: 'r3',
        },
        {
          user: { login: 'vic' },
          state: 'COMMENTED',
          body: 'Nice',
          submitted_at: '2026-10-04T12:00:00Z',
          html_url: 'r4',
        },
        {
          user: { login: 'vic' },
          state: 'SOMETHING_NEW',
          body: 'x',
          submitted_at: '2026-10-04T13:00:00Z',
          html_url: 'r5',
        },
      ],
    };
  }
  return {
    status: 200,
    body: [{ user: noUser(), body: 'Thanks!', created_at: '2026-10-02T10:00:00Z', html_url: 'k1' }],
  };
}

describe('getPullRequestTimeline', () => {
  test('merges commits, reviews and comments, oldest first', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(respondTo);
    const result = await getPullRequestTimeline(client, ref(), { signal });
    expect(
      requests.map((request) => request.url).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual([
      `${prefix()}/issues/7/comments?per_page=100`,
      `${prefix()}/pulls/7/commits?per_page=100`,
      `${prefix()}/pulls/7/reviews?per_page=100`,
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        isTruncated: false,
        events: [
          {
            kind: 'commit',
            sha: 'c1',
            headline: 'Add a thing',
            author: 'ann',
            at: '2026-10-01T12:00:00+02:00',
            url: 'https://github.com/octo-org/hello-world/commit/c1',
          },
          {
            kind: 'comment',
            author: 'ghost',
            body: 'Thanks!',
            at: '2026-10-02T10:00:00Z',
            url: 'k1',
          },
          {
            kind: 'commit',
            sha: 'c2',
            headline: 'Fix it',
            author: 'Bo',
            at: '2026-10-03T10:00:00Z',
            url: 'u2',
          },
          {
            kind: 'review',
            verdict: 'approved',
            author: 'rita',
            body: '',
            at: '2026-10-04T10:00:00Z',
            url: 'r1',
          },
          {
            kind: 'review',
            verdict: 'commented',
            author: 'vic',
            body: 'Nice',
            at: '2026-10-04T12:00:00Z',
            url: 'r4',
          },
        ],
      },
    });
  });

  test('cuts a very long body', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub((request) => {
      if (request.url.includes('/issues/')) {
        return {
          status: 200,
          body: [
            {
              user: { login: 'vic' },
              body: 'x'.repeat(50_000),
              created_at: '2026-10-02T10:00:00Z',
              html_url: 'k',
            },
          ],
        };
      }
      return { status: 200, body: [] };
    });
    const result = await getPullRequestTimeline(client, ref(), { signal });
    expect(okValueFrom(result).events[0]).toStrictEqual({
      kind: 'comment',
      author: 'vic',
      body: 'x'.repeat(20_000),
      at: '2026-10-02T10:00:00Z',
      url: 'k',
    });
  });

  test('stops at ten pages of a list and says it was cut short', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub((request) => {
      if (request.url.includes('/commits')) {
        return {
          status: 200,
          body: [],
          headers: { link: `<${prefix()}/pulls/7/commits?per_page=100&page=2>; rel="next"` },
        };
      }
      return { status: 200, body: [] };
    });
    const result = await getPullRequestTimeline(client, ref(), { signal });
    expect(result.ok && result.value.isTruncated).toBe(true);
    // Ten pages of commits, one of reviews, one of comments.
    expect(requests).toHaveLength(12);
  });

  test('fails when a list is not what GitHub documents', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub((request) => {
      if (request.url.includes('/reviews')) {
        return { status: 200, body: { not: 'a list' } };
      }
      return { status: 200, body: [] };
    });
    const result = await getPullRequestTimeline(client, ref(), { signal });
    expect(result.ok).toBe(false);
  });

  test('fails when GitHub refuses', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 404, body: { message: 'Not Found' } };
    });
    const result = await getPullRequestTimeline(client, ref(), { signal });
    expect(result.ok).toBe(false);
  });
});
