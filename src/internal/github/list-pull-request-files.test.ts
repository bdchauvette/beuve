import { describe, expect, it } from 'vitest';

import { listPullRequestCommits } from './list-pull-request-commits.ts';
import { listPullRequestFiles } from './list-pull-request-files.ts';
import { createFakeGithub } from './testing/create-fake-github.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

const ref = { owner: 'octo-org', repo: 'hello-world', number: 1347 };
const page2 = 'https://api.github.com/repositories/1/pulls/1347/files?per_page=100&page=2';

describe('listPullRequestFiles', () => {
  it('follows Link: rel="next" and drops patches', async () => {
    const { client, requests } = createFakeGithub((_request, index) =>
      index === 0
        ? {
            status: 200,
            body: [githubFixtures.files[0]],
            headers: { link: `<${page2}>; rel="next", <${page2}>; rel="last"` },
          }
        : { status: 200, body: [githubFixtures.files[1]] },
    );
    const result = await listPullRequestFiles(client, ref);
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/octo-org/hello-world/pulls/1347/files?per_page=100',
      page2,
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        isTruncated: false,
        items: [
          {
            path: 'src/feature.ts',
            previousPath: undefined,
            status: 'modified',
            additions: 103,
            deletions: 21,
            hasPatch: true,
          },
          {
            path: 'assets/logo.png',
            previousPath: 'logo.png',
            status: 'renamed',
            additions: 0,
            deletions: 0,
            hasPatch: false,
          },
        ],
      },
    });
  });

  it('stops at maxPages and says so', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 200,
      body: [githubFixtures.files[0]],
      headers: { link: `<${page2}>; rel="next"` },
    }));
    const result = await listPullRequestFiles(client, ref, { maxPages: 2 });
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, value: { isTruncated: true } });
  });

  it('refuses a next link off the API origin', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 200,
      body: [],
      headers: { link: '<https://evil.example.com/steal>; rel="next"' },
    }));
    await expect(listPullRequestFiles(client, ref)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-request' },
    });
    expect(requests).toHaveLength(1);
  });

  it('reports a page of the wrong shape', async () => {
    const { client } = createFakeGithub(() => ({ status: 200, body: { files: [] } }));
    await expect(listPullRequestFiles(client, ref)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });
});

describe('listPullRequestCommits', () => {
  it('decodes commits with their parents', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 200,
      body: githubFixtures.commits,
    }));
    const result = await listPullRequestCommits(client, ref);
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/octo-org/hello-world/pulls/1347/commits?per_page=100',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        isTruncated: false,
        items: [
          {
            sha: githubFixtures.headSha,
            parents: [githubFixtures.baseSha],
            message: 'Fix all the bugs\n\nAnd explain why.',
            authorName: 'Monalisa Octocat',
            authoredAt: '2026-10-01T16:00:49Z',
          },
        ],
      },
    });
  });
});
