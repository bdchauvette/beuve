import { describe } from 'vitest';

import { getPullRequestReviews } from './get-pull-request-reviews.ts';
import { getReviewRequests } from './get-review-requests.ts';
import { test } from './testing/test.ts';

function ref(): { owner: string; repo: string; number: number } {
  return { owner: 'octo-org', repo: 'hello-world', number: 7 };
}

describe('getPullRequestReviews', () => {
  test('decodes submitted reviews and drops pending and unknown states', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: JSON.stringify([
          {
            user: { login: 'rita' },
            state: 'CHANGES_REQUESTED',
            commit_id: 'a',
            submitted_at: '2026-10-01T10:00:00Z',
          },
          {
            user: { login: 'rita' },
            state: 'APPROVED',
            commit_id: 'b',
            submitted_at: '2026-10-02T10:00:00Z',
          },
          { user: { login: 'vic' }, state: 'PENDING', commit_id: 'b' },
          { state: 'COMMENTED', submitted_at: '2026-10-03T10:00:00Z', user: noUser() },
          {
            user: { login: 'vic' },
            state: 'SOMETHING_NEW',
            commit_id: 'b',
            submitted_at: '2026-10-03T10:00:00Z',
          },
        ]),
      };
    });
    const result = await getPullRequestReviews(client, ref(), { signal });
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/octo-org/hello-world/pulls/7/reviews?per_page=100',
    );
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          reviewer: 'rita',
          verdict: 'changes-requested',
          commitSha: 'a',
          submittedAt: '2026-10-01T10:00:00Z',
        },
        {
          reviewer: 'rita',
          verdict: 'approved',
          commitSha: 'b',
          submittedAt: '2026-10-02T10:00:00Z',
        },
        {
          reviewer: 'ghost',
          verdict: 'commented',
          commitSha: undefined,
          submittedAt: '2026-10-03T10:00:00Z',
        },
      ],
    });
  });

  test('reports a body of the wrong shape', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 200, body: { not: 'a list' } };
    });
    await expect(getPullRequestReviews(client, ref(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });
});

describe('getReviewRequests', () => {
  test('lists requested users and teams', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: { users: [{ login: 'vic' }], teams: [{ slug: 'platform' }] },
      };
    });
    await expect(getReviewRequests(client, ref(), { signal })).resolves.toStrictEqual({
      ok: true,
      value: { users: ['vic'], teams: ['platform'] },
    });
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/octo-org/hello-world/pulls/7/requested_reviewers',
    );
  });

  test('reports a body of the wrong shape and a missing pull request', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const wrong = fakeGithub(() => {
      return { status: 200, body: [] };
    });
    await expect(getReviewRequests(wrong.client, ref(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
    const missing = fakeGithub(() => {
      return { status: 404, body: { message: 'Not Found' } };
    });
    await expect(getReviewRequests(missing.client, ref(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    });
  });
});

function noUser(): unknown {
  return JSON.parse('null') as unknown;
}
