import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { findBranchPullRequest } from './find-branch-pull-request.ts';
import fixtures from './testing/github-fixtures.json' with { type: 'json' };

/** The fixture pull request, moved into `octo-org/hello-world`'s own `branch` as `number`. */
function pullFrom(number: number, branch: string): unknown {
  const { pullRequest } = fixtures;
  return {
    ...pullRequest,
    number,
    head: { ...pullRequest.head, ref: branch, repo: pullRequest.base.repo },
  };
}

describe('findBranchPullRequest', () => {
  test('asks for open pull requests headed at the branch and picks the lowest number', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: [pullFrom(9, 'claude/x'), pullFrom(4, 'claude/x'), pullFrom(2, 'other')],
        headers: { etag: '"p1"' },
      };
    });
    const found = await findBranchPullRequest(
      client,
      { owner: 'octo-org', repo: 'hello-world', branch: 'claude/x' },
      { signal },
    );
    expect(found).toMatchObject({
      ok: true,
      value: { kind: 'modified', etag: '"p1"', value: { number: 4 } },
    });
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/octo-org/hello-world/pulls?state=open&head=octo-org%3Aclaude%2Fx&per_page=100',
    );
  });

  test.for([
    ['no pull request', []],
    [
      'only a fork’s pull request',
      [{ ...(pullFrom(5, 'claude/x') as object), head: fixtures.pullRequest.head }],
    ],
  ] as const)('finds nothing with %s', async ([, body], { expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 200, body };
    });
    await expect(
      findBranchPullRequest(
        client,
        { owner: 'octo-org', repo: 'hello-world', branch: 'claude/x' },
        { signal },
      ),
    ).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'modified', value: undefined, etag: undefined },
    });
  });

  test('answers 304 as not modified', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 304 };
    });
    await expect(
      findBranchPullRequest(
        client,
        { owner: 'o', repo: 'r', branch: 'b' },
        { etag: '"p1"', signal },
      ),
    ).resolves.toStrictEqual({ ok: true, value: { kind: 'not-modified' } });
  });
});
