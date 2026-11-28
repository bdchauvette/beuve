import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { postPullRequestReview } from './post-pull-request-review.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { ReviewPayload } from './review-payload.ts';
import type { FakeResponse } from './testing/create-fake-github.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

function ref(): Omit<PullRequestRef, 'host'> {
  return { owner: 'octo-org', repo: 'hello-world', number: 1347 };
}

function payload(): ReviewPayload {
  return {
    commit_id: githubFixtures.headSha,
    event: 'REQUEST_CHANGES',
    body: '**beuve review: changes requested**',
    comments: [
      { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'Blocker: null deref.' },
      {
        path: 'src/b.ts',
        start_line: 3,
        start_side: 'RIGHT',
        line: 5,
        side: 'RIGHT',
        body: 'Nit.',
      },
    ],
  };
}

function offDiff(): FakeResponse {
  return {
    status: 422,
    body: {
      message: 'Unprocessable Entity',
      errors: ['Pull request review thread line must be part of the diff'],
      documentation_url:
        'https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request',
    },
  };
}

describe('postPullRequestReview', () => {
  test('posts the payload() as one submitted review', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: githubFixtures.review,
      };
    });
    const result = await postPullRequestReview(
      client,
      { ref: ref(), payload: payload() },
      { signal },
    );
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/octo-org/hello-world/pulls/1347/reviews',
      body: payload(),
    });
    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: 80,
        htmlUrl: 'https://github.com/octo-org/hello-world/pull/1347#pullrequestreview-80',
        state: 'COMMENTED',
      },
    });
  });

  test("types the refusal to approve or request changes on one's own pull request", async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 422,
        body: {
          message: 'Unprocessable Entity',
          errors: ['Can not request changes on your own pull request'],
        },
      };
    });
    await expect(
      postPullRequestReview(client, { ref: ref(), payload: payload() }, { signal }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'cannot-review-own-pull-request',
        event: 'REQUEST_CHANGES',
        message: 'Can not request changes on your own pull request',
      },
    });
  });

  test('reports rejected comments, without retrying', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => offDiff());
    await expect(
      postPullRequestReview(client, { ref: ref(), payload: payload() }, { signal }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'comments-rejected',
        messages: [
          'Unprocessable Entity',
          'Pull request review thread line must be part of the diff',
        ],
        failedCommentIndexes: undefined,
      },
    });
    expect(requests).toHaveLength(1);
  });

  test('names the comments GitHub refused when its message says which', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 422,
        body: {
          message: 'Validation Failed',
          errors: [
            {
              resource: 'PullRequestReviewComment',
              field: 'pull_request_review_thread.path',
              code: 'invalid',
              message: 'src/b.ts is not part of the diff',
            },
          ],
        },
      };
    });
    await expect(
      postPullRequestReview(client, { ref: ref(), payload: payload() }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'comments-rejected', failedCommentIndexes: [1] },
    });
    expect(requests).toHaveLength(1);
  });

  test('types a commit_id that is not part of the pull request', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 422,
        body: {
          message: 'Validation Failed',
          errors: [{ resource: 'PullRequestReview', field: 'commit_id', code: 'invalid' }],
        },
      };
    });
    await expect(
      postPullRequestReview(
        client,
        { ref: ref(), payload: { ...payload(), comments: [] } },
        { signal },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-commit', commitId: githubFixtures.headSha },
    });
  });

  test('passes other errors through', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      };
    });
    await expect(
      postPullRequestReview(client, { ref: ref(), payload: payload() }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});
