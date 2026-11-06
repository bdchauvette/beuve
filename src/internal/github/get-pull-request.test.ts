import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { getPullRequest } from './get-pull-request.ts';
import type { PullRequestRef } from './pull-request.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

function ref(): Omit<PullRequestRef, 'host'> {
  return { owner: 'octo-org', repo: 'hello-world', number: 1347 };
}

describe('getPullRequest', () => {
  test('decodes a pull request from a fork', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: githubFixtures.pullRequest,
        headers: { etag: 'W/"pr-1"' },
      };
    });
    const result = await getPullRequest(client, ref(), { signal });
    expect(requests[0]?.url).toBe('https://api.github.com/repos/octo-org/hello-world/pulls/1347');
    expect(result).toStrictEqual({
      ok: true,
      value: {
        kind: 'modified',
        etag: 'W/"pr-1"',
        value: {
          number: 1347,
          title: 'Amazing new feature',
          body: 'REQ-1: users can do the amazing thing.\n\nFixes #1200.',
          state: 'open',
          isDraft: false,
          author: 'octocat',
          base: {
            ref: 'main',
            sha: githubFixtures.baseSha,
            repository: {
              owner: 'octo-org',
              name: 'hello-world',
              fullName: 'octo-org/hello-world',
              cloneUrl: 'https://github.com/octo-org/hello-world.git',
            },
          },
          head: {
            ref: 'new-topic',
            sha: githubFixtures.headSha,
            repository: {
              owner: 'forker',
              name: 'hello-world',
              fullName: 'forker/hello-world',
              cloneUrl: 'https://github.com/forker/hello-world.git',
            },
          },
          isCrossRepository: true,
          mergeable: 'mergeable',
          mergeableState: 'clean',
          htmlUrl: 'https://github.com/octo-org/hello-world/pull/1347',
          createdAt: '2026-10-01T19:01:12Z',
          updatedAt: '2026-10-02T19:01:12Z',
          size: { additions: 100, deletions: 3, changedFiles: 5 },
        },
      },
    });
  });

  test('folds merged, deleted forks, ghosts, empty bodies and pending mergeability', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 200,
        body: { ...githubFixtures.pullRequest, ...githubFixtures.mergedFromDeletedFork },
      };
    });
    const result = await getPullRequest(client, ref(), { signal });
    expect(result).toMatchObject({
      ok: true,
      value: {
        value: {
          state: 'merged',
          author: 'ghost',
          body: '',
          isDraft: true,
          mergeable: 'unknown',
          isCrossRepository: true,
          head: { repository: undefined },
        },
      },
    });
  });

  test('polls with the ETag and reports not-modified', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return { status: 304 };
    });
    await expect(
      getPullRequest(client, ref(), { etag: 'W/"pr-1"', signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'not-modified' },
    });
    expect(requests[0]?.headers['If-None-Match']).toBe('W/"pr-1"');
  });

  test('rejects a response without valid SHAs', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 200,
        body: {
          ...githubFixtures.pullRequest,
          head: { ...githubFixtures.pullRequest.head, sha: 'main' },
        },
      };
    });
    await expect(getPullRequest(client, ref(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });

  test('passes not-found through', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 404, body: { message: 'Not Found' } };
    });
    await expect(getPullRequest(client, ref(), { signal })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not-found', message: 'Not Found' },
    });
  });
});
