import { describe, expect, it } from 'vitest';

import { moveCommentsToBody } from './move-comments-to-body.ts';
import { postPullRequestReview } from './post-pull-request-review.ts';
import type { ReviewPayload } from './review-payload.ts';
import { createFakeGithub } from './testing/create-fake-github.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

const movedHeading = /^### Comments/;
const ref = { owner: 'octo-org', repo: 'hello-world', number: 1347 };

const payload: ReviewPayload = {
  commit_id: githubFixtures.headSha,
  event: 'REQUEST_CHANGES',
  body: '**beuve review: changes requested**',
  comments: [
    { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'Blocker: null deref.' },
    { path: 'src/b.ts', start_line: 3, start_side: 'RIGHT', line: 5, side: 'RIGHT', body: 'Nit.' },
  ],
};

const offDiff = {
  status: 422,
  body: {
    message: 'Unprocessable Entity',
    errors: ['Pull request review thread line must be part of the diff'],
    documentation_url:
      'https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request',
  },
};

describe('postPullRequestReview', () => {
  it('posts the payload as one submitted review', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 200,
      body: githubFixtures.review,
    }));
    const result = await postPullRequestReview(client, ref, payload);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/octo-org/hello-world/pulls/1347/reviews',
      body: payload,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: 80,
        htmlUrl: 'https://github.com/octo-org/hello-world/pull/1347#pullrequestreview-80',
        state: 'COMMENTED',
        movedToBody: 0,
      },
    });
  });

  it("types the refusal to approve or request changes on one's own pull request", async () => {
    const { client } = createFakeGithub(() => ({
      status: 422,
      body: {
        message: 'Unprocessable Entity',
        errors: ['Can not request changes on your own pull request'],
      },
    }));
    await expect(postPullRequestReview(client, ref, payload)).resolves.toEqual({
      ok: false,
      error: {
        kind: 'cannot-review-own-pull-request',
        event: 'REQUEST_CHANGES',
        message: 'Can not request changes on your own pull request',
      },
    });
  });

  it('reports rejected comments, without retrying by default', async () => {
    const { client, requests } = createFakeGithub(() => offDiff);
    await expect(postPullRequestReview(client, ref, payload)).resolves.toEqual({
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

  it('falls back to moving every comment into the body when GitHub does not say which failed', async () => {
    const { client, requests } = createFakeGithub((_request, index) =>
      index === 0 ? offDiff : { status: 200, body: githubFixtures.review },
    );
    const result = await postPullRequestReview(client, ref, payload, {
      onRejectedComments: 'move-to-body',
    });
    expect(result).toMatchObject({ ok: true, value: { id: 80, movedToBody: 2 } });
    expect(requests[1]?.body).toEqual(moveCommentsToBody(payload));
  });

  it('moves only the comments GitHub names', async () => {
    const { client, requests } = createFakeGithub((_request, index) =>
      index === 0
        ? {
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
          }
        : { status: 200, body: githubFixtures.review },
    );
    const result = await postPullRequestReview(client, ref, payload, {
      onRejectedComments: 'move-to-body',
    });
    expect(result).toMatchObject({ ok: true, value: { movedToBody: 1 } });
    expect((requests[1]?.body as ReviewPayload).comments.map((comment) => comment.path)).toEqual([
      'src/a.ts',
    ]);
  });

  it('types a commit_id that is not part of the pull request', async () => {
    const { client } = createFakeGithub(() => ({
      status: 422,
      body: {
        message: 'Validation Failed',
        errors: [{ resource: 'PullRequestReview', field: 'commit_id', code: 'invalid' }],
      },
    }));
    await expect(
      postPullRequestReview(client, ref, { ...payload, comments: [] }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'stale-commit', commitId: githubFixtures.headSha },
    });
  });

  it('passes other errors through', async () => {
    const { client } = createFakeGithub(() => ({
      status: 403,
      body: { message: 'Resource not accessible by integration' },
    }));
    await expect(postPullRequestReview(client, ref, payload)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});

describe('moveCommentsToBody', () => {
  it('appends the picked comments to the body under their locations', () => {
    expect(moveCommentsToBody(payload, (_comment, index) => index === 1)).toEqual({
      ...payload,
      body: [
        '**beuve review: changes requested**',
        '### Comments GitHub could not attach to the diff',
        '**`src/b.ts`, lines 3–5**\n\nNit.',
      ].join('\n\n'),
      comments: [payload.comments[0]],
    });
  });

  it('returns the payload unchanged when nothing moves', () => {
    expect(moveCommentsToBody(payload, () => false)).toBe(payload);
    expect(moveCommentsToBody({ ...payload, body: '' }).body).toMatch(movedHeading);
  });
});
