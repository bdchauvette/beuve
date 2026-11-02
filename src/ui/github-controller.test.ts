import { describe } from 'vitest';

import { createCiStatus } from './testing/create-ci-status.ts';
import { createGithubHarness } from './testing/create-github-harness.ts';
import { createGithubPreview } from './testing/create-github-preview.ts';
import { createPullRequestUpdate } from './testing/create-pull-request-update.ts';
import { test } from './testing/test.ts';

interface OkReply {
  readonly ok: true;
  readonly value: unknown;
}

interface FailedReply {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

interface FailedOptions {
  readonly code: string;
  readonly message: string;
}

interface ReviewRef {
  readonly sessionId: string;
  readonly headSha: string;
}

function reviewOf(): ReviewRef {
  return { sessionId: 's1', headSha: 'a'.repeat(40) };
}

function previewReply(headSha: string): OkReply {
  return ok(createGithubPreview({ sessionId: 's1', headSha }));
}

function ok(value: unknown): OkReply {
  return { ok: true, value };
}

function failed(error: FailedOptions): FailedReply {
  return { ok: false, error };
}

describe('GithubController', () => {
  test('subscribes to both events while the host is connected', ({ expect }) => {
    const { github, listening } = createGithubHarness();
    github.hostConnected();
    expect(listening()).toBe(2);
    github.hostDisconnected();
    expect(listening()).toBe(0);
  });

  test('keeps the CI status of the open session only', ({ expect }) => {
    const { github, emit } = createGithubHarness({ review: reviewOf() });
    github.hostConnected();
    emit('github:ci-status', { sessionId: 's2', ci: createCiStatus() });
    expect(github.ci).toBeUndefined();
    const ci = createCiStatus();
    emit('github:ci-status', { sessionId: 's1', ci });
    expect(github.ci).toBe(ci);
  });

  test('forgets pull request, CI and post state on reset', ({ expect }) => {
    const { github, emit } = createGithubHarness({ review: reviewOf() });
    github.hostConnected();
    emit('github:ci-status', { sessionId: 's1', ci: createCiStatus() });
    github.reset();
    expect(github.ci).toBeUndefined();
    expect(github.post).toStrictEqual({ kind: 'idle' });
  });

  test('refreshes sessions on an update but ignores other sessions', async ({ expect }) => {
    const { github, emit, refreshes, selected } = createGithubHarness({ review: reviewOf() });
    github.hostConnected();
    emit('github:pr-updated', createPullRequestUpdate({ sessionId: 's2', headMoved: true }));
    await expect.poll(refreshes).toBe(1);
    expect(selected).toStrictEqual([]);
  });

  test('a moved head voids a confirmation, says so and reloads the review', async ({ expect }) => {
    const { github, emit, notices, selected } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': previewReply(reviewOf().headSha),
      },
    });
    github.hostConnected();
    await github.previewReview();
    expect(github.post.kind).toBe('confirm');
    emit('github:pr-updated', createPullRequestUpdate({ sessionId: 's1', headMoved: true }));
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
    expect(notices.map(({ tone }) => tone)).toStrictEqual(['info']);
    await expect.poll(() => selected).toStrictEqual(['s1']);
  });

  test('invalidating leaves an idle or posted state alone', ({ expect }) => {
    const { github } = createGithubHarness();
    github.invalidatePost();
    expect(github.post).toStrictEqual({ kind: 'idle' });
  });

  test('previews only with a review open', async ({ expect }) => {
    const { github, invoked } = createGithubHarness();
    await github.previewReview();
    expect(invoked).toStrictEqual([]);
    expect(github.post).toStrictEqual({ kind: 'idle' });
  });

  test('asks main to preview the head the reviewer sees and then confirms', async ({ expect }) => {
    const { github, invoked } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': previewReply(reviewOf().headSha),
      },
    });
    await github.previewReview();
    expect(invoked).toStrictEqual([
      ['github:preview-review', { sessionId: 's1', expectedHeadSha: reviewOf().headSha }],
    ]);
    expect(github.post.kind).toBe('confirm');
  });

  test('notes a preview for another head quietly', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': previewReply('b'.repeat(40)),
      },
    });
    await github.previewReview();
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
  });

  test('main refusing a preview because the head moved reloads the review', async ({ expect }) => {
    const { github, selected } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': ok({ kind: 'failed', failure: 'head-moved', message: 'moved' }),
      },
    });
    await github.previewReview();
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
    await expect.poll(() => selected).toStrictEqual(['s1']);
  });

  test('shows a failed preview', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': failed({ code: 'invalid-request', message: 'no token' }),
      },
    });
    await github.previewReview();
    expect(github.post).toStrictEqual({ kind: 'failed', text: 'no token' });
  });

  test('posts on the head the confirmation showed', async ({ expect }) => {
    const preview = createGithubPreview({ sessionId: 's1', headSha: reviewOf().headSha });
    const { github, invoked } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': previewReply(reviewOf().headSha),
        'github:post-review': ok({
          ...preview,
          kind: 'posted',
          url: 'https://github.com/o/r/pull/7#review-1',
          movedToBody: 1,
        }),
      },
    });
    await github.previewReview();
    await github.postReview({ verdict: 'comment', summary: 'Edited.' });
    expect(invoked.at(-1)).toStrictEqual([
      'github:post-review',
      {
        sessionId: 's1',
        expectedHeadSha: reviewOf().headSha,
        verdict: 'comment',
        summary: 'Edited.',
      },
    ]);
    expect(github.post).toMatchObject({
      kind: 'posted',
      url: 'https://github.com/o/r/pull/7#review-1',
    });
  });

  test('offers a comment after GitHub refuses an own approval, keeping the summary', async ({
    expect,
  }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:post-review': ok({
          kind: 'failed',
          failure: 'own-pull-request',
          message: 'your own',
        }),
      },
    });
    await github.postReview({ summary: 'Mine.' });
    expect(github.post).toStrictEqual({
      kind: 'own-pull-request',
      message: 'your own',
      summary: 'Mine.',
    });
    github.invalidatePost();
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
  });

  test('cancelling a post returns to idle', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:post-review': failed({ code: 'invalid-request', message: 'nope' }) },
    });
    await github.postReview({});
    expect(github.post.kind).toBe('failed');
    github.cancelPost();
    expect(github.post).toStrictEqual({ kind: 'idle' });
  });

  test('keeps the failure of a pull request that did not open and shows the dialog', async ({
    expect,
  }) => {
    const { github, dialogs, selected } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:open-pr': ok({
          kind: 'failed',
          failure: 'not-found',
          message: 'No such pull request.',
        }),
      },
    });
    await github.open({ ref: 'o/r#9' });
    expect(github.failure).toStrictEqual({ message: 'No such pull request.' });
    expect(github.isOpening).toBe(false);
    expect(dialogs).toStrictEqual([true]);
    expect(selected).toStrictEqual([]);
    github.clearFailure();
    expect(github.failure).toBeUndefined();
  });

  test('opens nothing and says nothing when the fetch is cancelled', async ({ expect }) => {
    const { github, dialogs } = createGithubHarness({
      replies: { 'github:open-pr': failed({ code: 'cancelled', message: 'cancelled' }) },
    });
    await github.open({ ref: 'o/r#9' });
    expect(github.failure).toBeUndefined();
    expect(dialogs).toStrictEqual([]);
  });

  test('closes the dialog and selects the opened session', async ({ expect }) => {
    const { github, dialogs, selected, refreshes } = createGithubHarness({
      replies: { 'github:open-pr': ok({ kind: 'opened', session: { id: 's9' } }) },
    });
    await github.open({ ref: 'o/r#9' });
    expect(dialogs).toStrictEqual([false]);
    expect(refreshes()).toBe(1);
    expect(selected).toStrictEqual(['s9']);
  });
});
