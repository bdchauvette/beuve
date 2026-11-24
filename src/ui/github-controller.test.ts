import { describe } from 'vitest';

import type { SessionSourceView, SessionSummary } from '#contract/ipc-contract.ts';

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

interface RequestIdOf {
  readonly requestId: string;
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

function cancelled(): FailedReply {
  return failed({ code: 'cancelled', message: 'cancelled' });
}

function pullRequestSource(): SessionSourceView {
  return {
    kind: 'github-pull-request',
    repoPath: '/clone',
    baseRef: 'refs/beuve/pr/7/base',
    host: 'github.com',
    owner: 'o',
    repo: 'r',
    number: 7,
  };
}

function createSessionSummary(source: SessionSourceView): SessionSummary {
  return {
    id: 's1',
    source,
    headSha: 'a'.repeat(40),
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
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
        action: { label: 'Reload', command: 'reload-review' },
      },
    ]);
    expect(github.hasNewCommits).toBe(true);
    expect(selected).toStrictEqual([]);
  });

  test('Reload Review loads the new head without the moved-head note', async ({ expect }) => {
    const { github, emit } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:get-timeline': emptyTimelineReply(),
        'github:open-pr': ok({ kind: 'opened', session: { id: 's1' } }),
      },
    });
    github.hostConnected();
    emit('github:pr-updated', createPullRequestUpdate({ sessionId: 's1', headMoved: true }));
    await github.reload(createSessionSummary(pullRequestSource()));
    github.reviewLoaded({ isNewHead: true });
    expect(github.post).toStrictEqual({ kind: 'idle' });
    expect(github.hasNewCommits).toBe(false);
  });

  test('a new head the reviewer did not ask for keeps the note', async ({ expect }) => {
    const { github, emit, selected } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:get-timeline': emptyTimelineReply(),
        'github:post-review': ok({ kind: 'failed', failure: 'head-moved', message: 'moved' }),
        'github:open-pr': ok({ kind: 'opened', session: { id: 's1' } }),
      },
    });
    github.hostConnected();
    emit('github:pr-updated', createPullRequestUpdate({ sessionId: 's1', headMoved: true }));
    await github.reload(createSessionSummary(pullRequestSource()));
    github.reviewLoaded({ isNewHead: false });
    emit('github:pr-updated', createPullRequestUpdate({ sessionId: 's1', headMoved: true }));
    github.reviewLoaded({ isNewHead: true });
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
    github.cancelPost();
    await github.postReview({});
    await expect.poll(() => selected).toStrictEqual(['s1', 's1']);
    github.reviewLoaded({ isNewHead: true });
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
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
    await expect(github.postReview({})).resolves.toBe(true);
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
    await expect(github.postReview({ summary: 'Mine.' })).resolves.toBe(false);
    expect(github.post).toStrictEqual({ kind: 'own-pull-request', message: 'your own' });
    github.invalidatePost();
    expect(github.post).toStrictEqual({ kind: 'head-moved' });
  });

  test('cancelling a post returns to idle', async ({ expect }) => {
    const { github } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:post-review': failed({ code: 'invalid-request', message: 'nope' }) },
    });
    await expect(github.postReview({})).resolves.toBe(false);
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

  test('shows a picked item’s fetch until its session starts loading (ADR 0146)', async ({
    expect,
  }) => {
    const { github, selected } = createGithubHarness({
      replies: { 'github:open-pr': ok({ kind: 'opened', session: { id: 's9' } }) },
    });
    const opening = github.open({ ref: 'github.com/o/r#12' }, { label: 'o/r#12 Fix it' });
    expect(github.fetch).toStrictEqual({
      kind: 'open',
      label: 'o/r#12 Fix it',
      stage: 'Fetching pull request #12…',
    });
    expect(github.isOpening).toBe(true);
    await opening;
    expect(github.fetch).toBeUndefined();
    expect(selected).toStrictEqual(['s9']);
  });

  test('names a branch being fetched by its branch', async ({ expect }) => {
    const { github } = createGithubHarness({ replies: { 'github:open-branch': cancelled() } });
    const opening = github.open({ ref: 'github.com/o/r:claude/x' }, { label: 'o/r:claude/x' });
    expect(github.fetch?.stage).toBe('Fetching branch claude/x…');
    await opening;
    expect(github.fetch).toBeUndefined();
  });

  test('ends the fetch when the open fails', async ({ expect }) => {
    const { github } = createGithubHarness({
      replies: { 'github:open-pr': failed({ code: 'network', message: 'Offline.' }) },
    });
    await github.open({ ref: 'o/r#9' }, { label: 'o/r#9' });
    expect(github.fetch).toBeUndefined();
    expect(github.failure).toStrictEqual({ message: 'Offline.' });
  });

  test('cancelling a fetch to open asks main to cancel its request', async ({ expect }) => {
    const { github, invoked } = createGithubHarness({ replies: { 'github:open-pr': cancelled() } });
    const opening = github.open({ ref: 'o/r#9' }, { label: 'o/r#9' });
    github.cancelOpening();
    await opening;
    const [opened, cancel] = invoked;
    expect(cancel?.[0]).toBe('request:cancel');
    expect(opened?.[0]).toBe('github:open-pr');
    expect(cancel?.[1]).toStrictEqual({ requestId: (opened?.[1] as RequestIdOf).requestId });
  });

  test('opens one at a time', async ({ expect }) => {
    const { github, invoked } = createGithubHarness({ replies: { 'github:open-pr': cancelled() } });
    const first = github.open({ ref: 'o/r#1' }, { label: 'o/r#1' });
    await github.open({ ref: 'o/r#2' }, { label: 'o/r#2' });
    await first;
    expect(invoked.map(([channel]) => channel)).toStrictEqual(['github:open-pr']);
  });

  test('reloads a pull request session the way it opened, in place', async ({ expect }) => {
    const { github, invoked, selected } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:open-pr': ok({ kind: 'opened', session: { id: 's1' } }) },
    });
    const reloading = github.reload(createSessionSummary(pullRequestSource()));
    expect(github.isReloading).toBe(true);
    expect(github.isOpening).toBe(false);
    await expect(reloading).resolves.toBe(true);
    expect(invoked[0]?.[1]).toMatchObject({ ref: 'github.com/o/r#7', repoPath: '/clone' });
    expect(selected).toStrictEqual(['s1']);
    expect(github.isReloading).toBe(false);
  });

  test('reloads a followed branch through github:open-branch', async ({ expect }) => {
    const { github, invoked } = createGithubHarness({
      review: reviewOf(),
      replies: { 'github:open-branch': ok({ kind: 'opened', session: { id: 's1' } }) },
    });
    await github.reload(
      createSessionSummary({
        kind: 'remote-branch',
        repoPath: '/clone',
        baseRef: 'refs/beuve/branch/x/base',
        forge: 'github',
        host: 'github.com',
        owner: 'o',
        repo: 'r',
        branch: 'claude/x',
      }),
    );
    expect(invoked[0]).toMatchObject([
      'github:open-branch',
      { ref: 'github.com/o/r:claude/x', repoPath: '/clone' },
    ]);
  });

  test('leaves a local session to its own reload', async ({ expect }) => {
    const { github, invoked } = createGithubHarness({ review: reviewOf() });
    const local = createSessionSummary({
      kind: 'local',
      repoPath: '/repo',
      baseRef: 'main',
      headRef: 'feature',
    });
    await expect(github.reload(local)).resolves.toBe(false);
    expect(invoked).toStrictEqual([]);
  });

  test('a failed reload is a notice and leaves the review and the dialog alone', async ({
    expect,
  }) => {
    const { github, notices, selected, dialogs } = createGithubHarness({
      review: reviewOf(),
      replies: {
        'github:open-pr': ok({
          kind: 'failed',
          failure: 'auth',
          message: 'GitHub refused the token.',
          remedy: 'Run gh auth login.',
        }),
      },
    });
    await github.reload(createSessionSummary(pullRequestSource()));
    expect(notices).toStrictEqual([
      { tone: 'error', text: 'GitHub refused the token. Run gh auth login.' },
    ]);
    expect(selected).toStrictEqual([]);
    expect(dialogs).toStrictEqual([]);
    expect(github.failure).toBeUndefined();
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
