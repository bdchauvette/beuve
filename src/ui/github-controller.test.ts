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

function postedReply(): OkReply {
  return ok({
    ...createGithubPreview({ sessionId: 's1', headSha: reviewOf().headSha }),
    kind: 'posted',
    url: 'https://github.com/o/r/pull/7#review-1',
    movedToBody: 1,
  });
}

function emptyTimelineReply(): OkReply {
  return ok({ kind: 'timeline', events: [], isTruncated: false });
}

function failed(error: FailedOptions): FailedReply {
  return { ok: false, error };
}

describe('GithubController', () => {
  test('subscribes to both events while the host is connected', ({ expect }) => {
    const { github, listening } = createGithubHarness();
    github.hostConnected();
    expect(listening()).toBe(3);
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

  test('a moved head voids posting and says so, but leaves the review alone', ({ expect }) => {
    const { github, emit, notices, selected } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:get-timeline': emptyTimelineReply() },
    });
    github.hostConnected();
    emit('github:pr-updated', createPullRequestUpdate({ sessionId: 's1', headMoved: true }));
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
    expect(notices).toStrictEqual([
      {
        tone: 'info',
        text: 'New commits on #7.',
        action: { label: 'Show', command: 'show-new-commits' },
      },
    ]);
    expect(github.hasNewCommits).toBe(true);
    expect(selected).toStrictEqual([]);
  });

  test('forgets the timeline when another session opens', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:get-timeline': emptyTimelineReply() },
    });
    await github.loadTimeline('s1');
    github.reset();
    expect(github.timeline).toBeUndefined();
  });

  test('invalidating leaves a review just posted alone', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': previewReply(reviewOf().headSha),
        'github:post-review': postedReply(),
      },
    });
    await github.postReview({});
    github.invalidatePost();
    expect(github.post.kind).toBe('posted');
  });

  test('previews only with a review open', async ({ expect }) => {
    const { github, invoked } = createGithubHarness();
    await github.refreshPreview();
    expect(invoked).toStrictEqual([]);
    expect(github.preview).toStrictEqual({ kind: 'none' });
  });

  test('asks main to preview the head the reviewer sees', async ({ expect }) => {
    const { github, invoked } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:preview-review': previewReply(reviewOf().headSha) },
    });
    await github.refreshPreview();
    expect(invoked).toStrictEqual([
      ['github:preview-review', { sessionId: 's1', expectedHeadSha: reviewOf().headSha }],
    ]);
    expect(github.preview).toStrictEqual({
      kind: 'ready',
      preview: createGithubPreview({ sessionId: 's1', headSha: reviewOf().headSha }),
    });
    expect(github.post).toStrictEqual({ kind: 'idle' });
  });

  test('keeps the last preview on screen while a fresh one compiles', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:preview-review': previewReply(reviewOf().headSha) },
    });
    await github.refreshPreview();
    const fresh = github.refreshPreview();
    expect(github.preview).toStrictEqual({
      kind: 'loading',
      last: createGithubPreview({ sessionId: 's1', headSha: reviewOf().headSha }),
    });
    await fresh;
    expect(github.preview.kind).toBe('ready');
  });

  test('previews a pull request session once per change, and nothing else', async ({ expect }) => {
    const staged = createGithubHarness({
      review: reviewOf(),
      staged: { items: [], verdict: 'approve' },
      replies: { 'github:preview-review': previewReply(reviewOf().headSha) },
    });
    staged.github.hostUpdated();
    staged.github.hostUpdated();
    await expect.poll(() => staged.github.preview.kind).toBe('ready');
    expect(staged.invoked.map(([channel]) => channel)).toStrictEqual(['github:preview-review']);
    const local = createGithubHarness({ review: reviewOf() });
    local.github.hostUpdated();
    await Promise.resolve();
    expect(local.invoked).toStrictEqual([]);
  });

  test('main finding the head moved voids posting without reloading the review', async ({
    expect,
  }) => {
    const { github, selected } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': ok({ kind: 'failed', failure: 'head-moved', message: 'moved' }),
      },
    });
    await github.refreshPreview();
    expect(github.preview).toStrictEqual({ kind: 'none' });
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
    expect(selected).toStrictEqual([]);
  });

  test('shows a failed preview', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': failed({ code: 'invalid-request', message: 'no token' }),
      },
    });
    await github.refreshPreview();
    expect(github.preview).toStrictEqual({ kind: 'failed', text: 'no token' });
    expect(github.post).toStrictEqual({ kind: 'idle' });
  });

  test('posts on the head the reviewer sees, then previews what posting again sends', async ({
    expect,
  }) => {
    const { github, invoked } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:preview-review': previewReply(reviewOf().headSha),
        'github:post-review': postedReply(),
      },
    });
    await github.postReview({ verdict: 'comment', summary: 'Edited.' });
    expect(invoked).toStrictEqual([
      [
        'github:post-review',
        {
          sessionId: 's1',
          expectedHeadSha: reviewOf().headSha,
          verdict: 'comment',
          summary: 'Edited.',
        },
      ],
      ['github:preview-review', { sessionId: 's1', expectedHeadSha: reviewOf().headSha }],
    ]);
    expect(github.post).toMatchObject({
      kind: 'posted',
      url: 'https://github.com/o/r/pull/7#review-1',
    });
    expect(github.preview.kind).toBe('ready');
  });

  test('offers a comment after GitHub refuses an own approval', async ({ expect }) => {
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
    expect(github.post).toStrictEqual({ kind: 'own-pull-request', message: 'your own' });
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

  test('follows a branch link through github:open-branch (ADR 0112)', async ({ expect }) => {
    const { github, invoked, selected } = createGithubHarness({
      replies: { 'github:open-branch': ok({ kind: 'opened', session: { id: 's7' } }) },
    });
    await github.open({ ref: 'https://github.com/o/r/tree/claude/x', repoPath: '/clone' });
    expect(invoked.map(([channel]) => channel)).toStrictEqual(['github:open-branch']);
    expect(invoked[0]?.[1]).toMatchObject({
      ref: 'https://github.com/o/r/tree/claude/x',
      repoPath: '/clone',
    });
    expect(selected).toStrictEqual(['s7']);
  });

  test.for([
    [
      'a new head',
      { headMoved: true, promoted: false, state: 'present', pullOwner: 'o' },
      [],
      'New commits',
    ],
    [
      'a promotion',
      { headMoved: false, promoted: true, state: 'present', pullOwner: 'o' },
      ['s1'],
      'as #7.',
    ],
    [
      'a promotion upstream',
      { headMoved: false, promoted: true, state: 'present', pullOwner: 'up' },
      ['s1'],
      'as up/r#7.',
    ],
    [
      'a deleted branch',
      { headMoved: false, promoted: false, state: 'gone', pullOwner: 'o' },
      [],
      'is gone',
    ],
  ] as const)('a branch update with %s says so', async ([, change, reloads, text], { expect }) => {
    const { github, emit, notices, selected } = createGithubHarness({ review: reviewOf() });
    github.hostConnected();
    emit('github:branch-updated', {
      sessionId: 's1',
      headMoved: change.headMoved,
      promoted: change.promoted,
      branch: {
        owner: 'o',
        repo: 'r',
        branch: 'claude/x',
        state: change.state,
        pullRequest: {
          owner: change.pullOwner,
          repo: 'r',
          number: 7,
          htmlUrl: `https://github.com/${change.pullOwner}/r/pull/7`,
        },
      },
    });
    expect(github.branch).toMatchObject({ branch: 'claude/x' });
    expect(notices.at(-1)?.text).toContain(text);
    await expect.poll(() => selected).toStrictEqual(reloads);
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
