import { describe, expect, it } from 'vitest';

import { getPullRequest } from './get-pull-request.ts';
import { createFakeGithub } from './testing/create-fake-github.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

const ref = { owner: 'octo-org', repo: 'hello-world', number: 1347 };

describe('getPullRequest', () => {
  it('decodes a pull request from a fork', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 200,
      body: githubFixtures.pullRequest,
      headers: { etag: 'W/"pr-1"' },
    }));
    const result = await getPullRequest(client, ref);
    expect(requests[0]?.url).toBe('https://api.github.com/repos/octo-org/hello-world/pulls/1347');
    expect(result).toEqual({
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
        },
      },
    });
  });

  it('folds merged, deleted forks, ghosts, empty bodies and pending mergeability', async () => {
    const { client } = createFakeGithub(() => ({
      status: 200,
      body: { ...githubFixtures.pullRequest, ...githubFixtures.mergedFromDeletedFork },
    }));
    const result = await getPullRequest(client, ref);
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

  it('polls with the ETag and reports not-modified', async () => {
    const { client, requests } = createFakeGithub(() => ({ status: 304 }));
    await expect(getPullRequest(client, ref, { etag: 'W/"pr-1"' })).resolves.toEqual({
      ok: true,
      value: { kind: 'not-modified' },
    });
    expect(requests[0]?.headers['If-None-Match']).toBe('W/"pr-1"');
  });

  it('rejects a response without valid SHAs', async () => {
    const { client } = createFakeGithub(() => ({
      status: 200,
      body: {
        ...githubFixtures.pullRequest,
        head: { ...githubFixtures.pullRequest.head, sha: 'main' },
      },
    }));
    await expect(getPullRequest(client, ref)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });

  it('passes not-found through', async () => {
    const { client } = createFakeGithub(() => ({ status: 404, body: { message: 'Not Found' } }));
    await expect(getPullRequest(client, ref)).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found', message: 'Not Found' },
    });
  });
});
