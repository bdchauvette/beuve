import { describe } from 'vitest';

import { listOpenPullRequests } from './list-open-pull-requests.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };
import { test } from './testing/test.ts';

describe('listOpenPullRequests', () => {
  test('lists one page of open pull requests, without sizes, and says when there were more', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { additions, deletions, changed_files, ...listed } = githubFixtures.pullRequest;
    expect([additions, deletions, changed_files]).toStrictEqual([100, 3, 5]);
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        headers: {
          etag: '"o1"',
          link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"',
        },
        body: [listed],
      };
    });
    const result = await listOpenPullRequests(client, { owner: 'o', repo: 'r' }, { signal });
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/o/r/pulls?state=open&sort=updated&direction=desc&per_page=100',
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'modified',
        etag: '"o1"',
        value: { isTruncated: true, items: [{ number: 1347, head: { ref: 'new-topic' } }] },
      },
    });
    expect(result).not.toHaveProperty('value.value.items.0.size');
  });

  test('answers not-modified for a matching ETag', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return { status: 304 };
    });
    await expect(
      listOpenPullRequests(client, { owner: 'o', repo: 'r' }, { etag: '"o1"', signal }),
    ).resolves.toStrictEqual({ ok: true, value: { kind: 'not-modified' } });
    expect(requests[0]?.headers).toMatchObject({ 'If-None-Match': '"o1"' });
  });
});
