import { describe } from 'vitest';

import { listReviewRequestEvents } from './list-review-request-events.ts';
import { test } from './testing/test.ts';

describe('listReviewRequestEvents', () => {
  test('keeps the review requests of people and teams, oldest first, across pages', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub((_request, index) => {
      if (index === 0) {
        return {
          status: 200,
          headers: {
            link: '<https://api.github.com/repos/o/r/issues/7/events?per_page=100&page=2>; rel="next"',
          },
          body: [
            { event: 'labeled', created_at: '2026-10-01T00:00:00Z' },
            {
              event: 'review_requested',
              created_at: '2026-10-02T00:00:00Z',
              requested_reviewer: { login: 'rita' },
            },
          ],
        };
      }
      return {
        status: 200,
        body: [
          {
            event: 'review_requested',
            created_at: '2026-10-03T00:00:00Z',
            requested_team: { slug: 'core', name: 'Core' },
          },
          {
            event: 'review_request_removed',
            created_at: '2026-10-04T00:00:00Z',
            requested_reviewer: { login: 'rita' },
          },
        ],
      };
    });
    const result = await listReviewRequestEvents(
      client,
      { owner: 'o', repo: 'r', number: 7 },
      { signal },
    );
    expect(requests.map((request) => request.url)).toStrictEqual([
      'https://api.github.com/repos/o/r/issues/7/events?per_page=100',
      'https://api.github.com/repos/o/r/issues/7/events?per_page=100&page=2',
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        events: [
          { at: '2026-10-02T00:00:00Z', reviewer: 'rita' },
          { at: '2026-10-03T00:00:00Z', team: 'core' },
        ],
        isTruncated: false,
      },
    });
  });

  test('fails on a page it cannot read', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 200, body: [{ event: 'review_requested' }] };
    });
    await expect(
      listReviewRequestEvents(client, { owner: 'o', repo: 'r', number: 7 }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'unexpected-shape' } });
  });
});
