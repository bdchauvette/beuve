import { describe, expect, it } from 'vitest';

import { findPullRequestStack } from './find-pull-request-stack.ts';
import type { PullRequest } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';
import { createFakeGithub } from './testing/create-fake-github.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

const sameRepoHead = {
  ...githubFixtures.pullRequest.head,
  label: 'octo-org:feature-2',
  ref: 'feature-2',
  repo: githubFixtures.pullRequest.base.repo,
};

function raw(
  number: number,
  base: string,
  head: string,
  repo = githubFixtures.pullRequest.base.repo,
): unknown {
  return {
    ...githubFixtures.pullRequest,
    number,
    base: { ...githubFixtures.pullRequest.base, ref: base },
    head: { ...sameRepoHead, ref: head, repo },
  };
}

function decode(body: unknown): PullRequest {
  return pullRequestSchema.parse(body);
}

describe('findPullRequestStack', () => {
  it('finds the parent and the children within the base repository', async () => {
    const pullRequest = decode(raw(20, 'feature-1', 'feature-2'));
    const { client, requests } = createFakeGithub((request) => {
      const url = new URL(request.url);
      if (url.searchParams.has('head')) {
        return { status: 200, body: [raw(10, 'main', 'feature-1')] };
      }
      return {
        status: 200,
        body: [
          raw(30, 'feature-2', 'feature-3'),
          raw(31, 'feature-2', 'feature-3b', githubFixtures.pullRequest.head.repo),
          raw(20, 'feature-2', 'feature-2'),
        ],
      };
    });
    const result = await findPullRequestStack(client, pullRequest);
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/octo-org/hello-world/pulls?state=open&per_page=100&head=octo-org%3Afeature-1',
      'https://api.github.com/repos/octo-org/hello-world/pulls?state=open&per_page=100&base=feature-2',
    ]);
    expect(result.ok && result.value.parents.map((parent) => parent.number)).toEqual([10]);
    expect(result.ok && result.value.children.map((child) => child.number)).toEqual([30]);
  });

  it('gives a pull request from a fork no children', async () => {
    const pullRequest = decode(githubFixtures.pullRequest);
    const { client, requests } = createFakeGithub(() => ({ status: 200, body: [] }));
    await expect(findPullRequestStack(client, pullRequest)).resolves.toEqual({
      ok: true,
      value: { parents: [], children: [] },
    });
    expect(requests).toHaveLength(1);
  });
});
