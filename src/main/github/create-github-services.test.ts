import { readFileSync } from 'node:fs';

import { describe } from 'vitest';

import type {
  FakeGithubApi,
  FakeSubmittedReview,
} from '#internal/github/testing/create-fake-github-api.ts';
import { advanceHead } from '#internal/session/advance-head.ts';
import type { CommitSha } from '#internal/session/session.ts';
import { updateSessionHead } from '#internal/session/update-session-head.ts';
import type { AppInfo, OpenPullRequestResponse } from '#contract/ipc-contract.ts';
import { startHoldServer } from '#internal/git/testing/start-hold-server.ts';
import { writeHoldScript } from '#internal/git/testing/write-hold-script.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { createIpcHandlers } from '../ipc/create-ipc-handlers.ts';
import { RequestScopes } from '../ipc/request-scopes.ts';
import type { MainServices } from '../main-services.ts';
import { createGitCaches } from '../sessions/create-git-caches.ts';
import { loadSession } from '../sessions/load-session.ts';
import { lines } from '../testing/lines.ts';
import { waitUntil } from '../testing/wait-until.ts';
import { test } from './testing/test.ts';
import type { GithubWorld } from './testing/test.ts';

describe('GitHub pull request sessions (integration: fake GitHub, fake gh, local bare remote)', () => {
  test('opens a pull request into a local clone, idempotently, and remembers the clone', async ({
    expect,
    services,
    openPull,
    repositories,
    world,
    signal,
  }) => {
    const { clone, baseSha, firstHead } = world;
    await expect(openPull()).resolves.toMatchObject({
      kind: 'failed',
      failure: 'needs-local-clone',
    });
    const stranger = await repositories.create();
    await expect(openPull(stranger.directory)).resolves.toMatchObject({
      kind: 'failed',
      failure: 'needs-local-clone',
      message: expect.stringContaining(
        'has no remote for github.com/octo-org/hello-world',
      ) as string,
    });

    const first = await openPull(clone.directory);
    expect(first).toMatchObject({
      kind: 'opened',
      repoPath: clone.directory,
      session: {
        headSha: firstHead,
        source: {
          kind: 'github-pull-request',
          repoPath: clone.directory,
          baseRef: 'refs/beuve/pr/7/base',
          host: 'github.com',
          owner: 'octo-org',
          repo: 'hello-world',
          number: 7,
        },
      },
      pullRequest: { title: 'Make the answer right', author: 'octocat', state: 'open' },
    });
    await expect(clone.git('rev-parse', 'refs/beuve/pr/7/head')).resolves.toBe(firstHead);
    await expect(clone.git('rev-parse', 'refs/beuve/pr/7/base')).resolves.toBe(baseSha);

    const again = await openPull();
    expect(openedSessionId(again)).toBe(openedSessionId(first));
    expect(okValueFrom(services.sessions.list())).toMatchObject([
      {
        source: { kind: 'github-pull-request', number: 7 },
        pullRequest: {
          title: 'Make the answer right',
          state: 'open',
          isDraft: false,
          baseBranch: 'main',
        },
      },
    ]);

    const sessionId = openedSessionId(first);
    const review = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(review.scope).toStrictEqual({ kind: 'full' });
    expect(review.baseSha).toBe(baseSha);
    expect(review.files.map((file) => file.path)).toStrictEqual(['app.ts', 'notes.md']);
    expect(okValueFrom(await services.github.getPullRequest(sessionId))).toMatchObject({
      pullRequest: { number: 7, body: expect.stringContaining('REQ-1') as string },
    });
  });

  test('follows a force-push between the API answer and the fetch by asking GitHub again', async ({
    services,
    expect,
    recreate,
    world,
    signal,
  }) => {
    const { upstream, clone, bare, firstHead, api } = world;
    await upstream.git('commit', '--quiet', '--amend', '--message', 'feature, amended');
    const amended = await upstream.git('rev-parse', 'HEAD');
    await upstream.git('push', '--quiet', '--force', bare, 'feature:refs/pull/7/head');
    const racing = racingFetch(api, { first: firstHead, later: amended });
    Object.assign(api, { fetch: racing.fetch });
    const restarted = recreate(services);
    const result = okValueFrom(
      await restarted.github.openPullRequest(
        {
          ref: 'https://github.com/octo-org/hello-world/pull/7/files',
          repoPath: clone.directory,
        },
        { signal },
      ),
    );
    expect(result).toMatchObject({ kind: 'opened', session: { headSha: amended } });
    expect(racing.pullGets()).toBe(2);
  });

  test('moves the head when polling sees a push, offering an interdiff, and rolls up CI with ETags', async ({
    expect,
    services,
    opened,
    updates,
    ciEvents,
    world,
    signal,
  }) => {
    const { upstream, bare, firstHead, api } = world;
    const sessionId = await opened();
    const reviewed = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    okValueFrom(
      await services.sessions.markReviewed({ sessionId, expectedHeadSha: reviewed.headSha }),
    );
    api.checks.set(firstHead, [
      { kind: 'check-run', name: 'test', result: 'success' },
      { kind: 'check-run', name: 'lint', result: 'in_progress' },
      { kind: 'status', name: 'ci/deploy', result: 'failure' },
    ]);

    await services.github.pollNow(sessionId);
    expect(ciEvents.at(-1)).toMatchObject({
      sessionId,
      ci: {
        sha: firstHead,
        overall: 'failure',
        counts: { success: 1, pending: 1, failure: 1, neutral: 0 },
      },
    });
    const ciCount = ciEvents.length;
    const updateCount = updates.length;
    await services.github.pollNow(sessionId);
    expect(ciEvents).toHaveLength(ciCount);
    expect(updates).toHaveLength(updateCount);
    expect(api.log.slice(-3).every((entry) => entry.startsWith('GET'))).toBe(true);

    upstream.write('app.ts', lines(['export const answer = 42;', 'export const other = 3;']));
    const secondHead = await upstream.commit('fixup');
    await upstream.git('push', '--quiet', bare, 'feature:refs/pull/7/head');
    Object.assign(api.pullRequests.get(7) ?? {}, {
      headSha: secondHead,
      updatedAt: '2026-10-28T11:00:00Z',
    });
    api.checks.set(secondHead, [{ kind: 'check-run', name: 'test', result: 'success' }]);
    await services.github.pollNow(sessionId);

    expect(updates.at(-1)).toMatchObject({
      sessionId,
      headMoved: true,
      pullRequest: { headSha: secondHead },
    });
    expect(ciEvents.at(-1)).toMatchObject({ ci: { sha: secondHead, overall: 'success' } });
    const interdiff = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(interdiff.headSha).toBe(secondHead);
    expect(interdiff.scope).toMatchObject({
      kind: 'interdiff',
      fromHeadSha: firstHead,
      outcome: { kind: 'exact' },
    });
    expect(interdiff.files.map((file) => file.path)).toStrictEqual(['app.ts']);
  });

  test('request:cancel stops opening a pull request mid-fetch, quietly (ADR 0079)', async ({
    expect,
    services,
    world,
    closing,
    signal,
  }) => {
    const { clone } = world;
    const server = closing(await startHoldServer(signal));
    const uploadPack = writeHoldScript(
      { directory: clone.scratch(), name: 'upload-pack' },
      server.port,
      {
        kind: 'upload-pack',
      },
    );
    await clone.git('config', 'remote.origin.uploadpack', uploadPack.command);
    const handlers = createIpcHandlers(services, appInfo(), { scopes: new RequestScopes() });
    const window = { webContentsId: 1 };
    const request = {
      ref: 'https://github.com/octo-org/hello-world/pull/7/files',
      repoPath: clone.directory,
      requestId: 'open-1',
    };
    const opening = handlers['github:open-pr'](request, window);
    const fetch = await server.next();
    expect(handlers['request:cancel']({ requestId: 'open-1' }, window)).toStrictEqual({
      ok: true,
      value: { cancelled: true },
    });
    await expect(opening).resolves.toStrictEqual({
      ok: false,
      error: { code: 'cancelled', message: 'cancelled' },
    });
    await expect(fetch.ended).resolves.toBeDefined();
    expect(services.sessions.list()).toStrictEqual({ ok: true, value: [] });
    await clone.git('config', '--unset', 'remote.origin.uploadpack');
    await expect(handlers['github:open-pr'](request, window)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'opened' },
    });
  });

  test('a head written behind the poller’s back is not pinned by its ETag (ADR 0079)', async ({
    expect,
    services,
    opened,
    db,
    deps,
    logger,
    world,
  }) => {
    const { firstHead, baseSha } = world;
    const context = { db, deps, logger: logger.logger, git: {}, caches: createGitCaches() };
    const sessionId = await opened();
    await services.github.pollNow(sessionId);
    const polled = okValueFrom(loadSession(context, sessionId));
    const behind = advanceHead(polled, baseSha as CommitSha);
    okValueFrom(updateSessionHead(db, behind, polled.headSha));
    await services.github.pollNow(sessionId);
    expect(okValueFrom(loadSession(context, sessionId)).headSha).toBe(firstHead);
  });

  test('derives whose turn it is from requests, reviews and CI, and pushes it with the update', async ({
    expect,
    services,
    opened,
    updates,
    world,
  }) => {
    const { api, firstHead } = world;
    const sessionId = await opened();
    const bump = (updatedAt: string): void => {
      Object.assign(api.pullRequests.get(7) ?? {}, { updatedAt });
    };

    api.requestedReviewers.set(7, { users: ['reviewer'], teams: [] });
    bump('2026-10-28T10:01:00Z');
    await services.github.pollNow(sessionId);
    expect(updates.at(-1)?.attention).toStrictEqual({
      turn: 'you',
      reasons: ['a review was requested from reviewer'],
    });
    expect(okValueFrom(await services.github.getPullRequest(sessionId)).attention?.turn).toBe(
      'you',
    );

    api.requestedReviewers.set(7, { users: [], teams: [] });
    api.submittedReviews.set(7, [reviewBy('CHANGES_REQUESTED', firstHead)]);
    bump('2026-10-28T10:02:00Z');
    await services.github.pollNow(sessionId);
    expect(updates.at(-1)?.attention).toStrictEqual({
      turn: 'author',
      reasons: ['rita requested changes'],
    });

    api.submittedReviews.set(7, [reviewBy('CHANGES_REQUESTED', 'e'.repeat(40))]);
    bump('2026-10-28T10:03:00Z');
    await services.github.pollNow(sessionId);
    expect(updates.at(-1)?.attention).toStrictEqual({
      turn: 'reviewers',
      reasons: ['the author pushed since rita requested changes'],
    });

    api.submittedReviews.set(7, [reviewBy('APPROVED', firstHead)]);
    bump('2026-10-28T10:04:00Z');
    await services.github.pollNow(sessionId);
    expect(updates.at(-1)?.attention?.turn).toBe('unknown');
    const before = updates.length;
    api.checks.set(firstHead, [{ kind: 'check-run', name: 'test', result: 'failure' }]);
    await services.github.pollNow(sessionId);
    expect(updates).toHaveLength(before + 1);
    expect(updates.at(-1)).toMatchObject({
      headMoved: false,
      attention: { turn: 'author', reasons: ['CI is failing (1 check)'] },
    });
  });

  test('posts the staged items as one review, then only new ones, with the own-PR and off-diff fallbacks', async ({
    expect,
    services,
    opened,
    world,
  }) => {
    const { firstHead, api, token } = world;
    const sessionId = await opened();
    const ura = services.ura;
    okValueFrom(
      await ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
        severity: 'issue',
        title: 'Name the constant',
        body: '42 needs a name.',
      }),
    );
    okValueFrom(
      await ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'notes.md' },
        severity: 'question',
        title: 'Why a notes file?',
        body: '',
      }),
    );

    expect(
      okValueFrom(await services.github.previewReview({ sessionId, expectedHeadSha: firstHead })),
    ).toStrictEqual({
      sessionId,
      headSha: firstHead,
      verdict: 'comment',
      inlineCount: 1,
      bodyCount: 1,
      alreadyPostedCount: 0,
    });

    api.viewer = 'octocat';
    expect(
      okValueFrom(
        await services.github.postReview({
          sessionId,
          verdict: 'request-changes',
          expectedHeadSha: firstHead,
        }),
      ),
    ).toMatchObject({
      kind: 'failed',
      failure: 'own-pull-request',
    });
    api.viewer = 'reviewer';

    const posted = okValueFrom(
      await services.github.postReview({ sessionId, expectedHeadSha: firstHead }),
    );
    expect(posted).toMatchObject({
      kind: 'posted',
      url: 'https://github.com/octo-org/hello-world/pull/7#pullrequestreview-1',
      inlineCount: 1,
      bodyCount: 1,
      movedToBody: 0,
    });
    expect(api.reviews).toHaveLength(1);
    expect(api.reviews[0]?.body).toMatchObject({
      commit_id: firstHead,
      event: 'COMMENT',
      comments: [{ path: 'app.ts', line: 1 }],
    });
    expect(api.reviews[0]?.token).toBe(token);
    expect(api.reviews[0]?.body.body.startsWith('### Not attached to a line\n\n')).toBe(true);
    expect(api.reviews[0]?.body.body).not.toContain('beuve');
    const listed = okValueFrom(await ura.list({ sessionId }));
    expect(listed.items.map((item) => item.posted?.placement)).toStrictEqual(['inline', 'body']);

    expect(
      okValueFrom(await services.github.previewReview({ sessionId, expectedHeadSha: firstHead })),
    ).toMatchObject({
      inlineCount: 0,
      bodyCount: 0,
      alreadyPostedCount: 2,
    });

    okValueFrom(
      await ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
        severity: 'nitpick',
        title: 'Trailing comment',
        body: 'Off the diff, says GitHub.',
      }),
    );
    api.rejectCommentPaths.add('app.ts');
    const fallback = okValueFrom(
      await services.github.postReview({
        sessionId,
        expectedHeadSha: firstHead,
        summary: 'One more nit, otherwise good.',
      }),
    );
    expect(fallback).toMatchObject({
      kind: 'posted',
      inlineCount: 0,
      bodyCount: 1,
      movedToBody: 1,
    });
    expect(api.reviews).toHaveLength(2);
    expect(api.reviews[1]?.body.comments).toStrictEqual([]);
    expect(api.reviews[1]?.body.body.startsWith('One more nit, otherwise good.\n\n')).toBe(true);
    expect(api.reviews[1]?.body.body).toContain('Comments GitHub could not attach to the diff');
  });

  test('posts nothing when the head moved after the reviewer opened the confirmation', async ({
    expect,
    services,
    opened,
    world,
    signal,
  }) => {
    const { firstHead, api } = world;
    const sessionId = await opened();
    await stageNote(services, sessionId);
    expect(
      okValueFrom(await services.github.previewReview({ sessionId, expectedHeadSha: firstHead })),
    ).toMatchObject({ headSha: firstHead, verdict: 'comment' });

    const secondHead = await pushHead(world, 'the author pushes while the dialog is open');
    await services.github.pollNow(sessionId);
    expect(okValueFrom(await services.sessions.getReview({ sessionId }, { signal })).headSha).toBe(
      secondHead,
    );

    const refused = okValueFrom(
      await services.github.postReview({ sessionId, expectedHeadSha: firstHead }),
    );
    expect(refused).toStrictEqual({
      kind: 'failed',
      failure: 'head-moved',
      message: 'The pull request changed since you opened this; review the new commits first.',
    });
    expect(
      okValueFrom(await services.github.previewReview({ sessionId, expectedHeadSha: firstHead })),
    ).toMatchObject({ kind: 'failed', failure: 'head-moved' });
    expect(api.reviews).toStrictEqual([]);
    expect(api.log.filter((entry) => entry.startsWith('POST'))).toStrictEqual([]);
    expect(okValueFrom(await services.ura.list({ sessionId })).items[0]?.posted).toBeUndefined();

    const posted = okValueFrom(
      await services.github.postReview({ sessionId, expectedHeadSha: secondHead }),
    );
    expect(posted).toMatchObject({ kind: 'posted', headSha: secondHead });
    expect(api.reviews.map((review) => review.body.commit_id)).toStrictEqual([secondHead]);
  });

  test('posts one review when two posts overlap', async ({
    expect,
    services,
    opened,
    recreate,
    world,
  }) => {
    const { firstHead, api } = world;
    const sessionId = await opened();
    await stageNote(services, sessionId);
    const held = holdReviewPosts(api);
    Object.assign(api, { fetch: held.fetch });
    const restarted = recreate(services);

    const first = restarted.github.postReview({ sessionId, expectedHeadSha: firstHead });
    await held.arrived;
    await expect(
      restarted.github.postReview({ sessionId, expectedHeadSha: firstHead }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    held.release();
    expect(okValueFrom(await first)).toMatchObject({ kind: 'posted', headSha: firstHead });
    expect(api.reviews).toHaveLength(1);
    expect(api.reviews[0]?.body.commit_id).toBe(firstHead);
    expect(
      okValueFrom(await restarted.github.postReview({ sessionId, expectedHeadSha: firstHead })),
    ).toMatchObject({ kind: 'posted', inlineCount: 0, alreadyPostedCount: 1 });
  });

  test('asks for the CI of the head it synced to, not the one GitHub first answered', async ({
    expect,
    opened,
    recreate,
    services,
    ciEvents,
    world,
    signal,
  }) => {
    const { upstream, bare, api } = world;
    const sessionId = await opened();
    upstream.write('app.ts', lines(['export const answer = 42;', 'export const other = 3;']));
    const answered = await upstream.commit('pushed, then amended');
    await upstream.git('commit', '--quiet', '--amend', '--message', 'amended');
    const synced = await upstream.git('rev-parse', 'HEAD');
    await upstream.git('push', '--quiet', '--force', bare, 'feature:refs/pull/7/head');
    Object.assign(api.pullRequests.get(7) ?? {}, { updatedAt: '2026-10-28T11:00:00Z' });
    api.checks.set(answered, [{ kind: 'check-run', name: 'test', result: 'success' }]);
    api.checks.set(synced, [{ kind: 'check-run', name: 'test', result: 'failure' }]);
    const racing = racingFetch(api, { first: answered, later: synced });
    Object.assign(api, { fetch: racing.fetch });
    const restarted = recreate(services);

    await restarted.github.pollNow(sessionId);
    expect(racing.pullGets()).toBe(2);
    expect(okValueFrom(await restarted.sessions.getReview({ sessionId }, { signal })).headSha).toBe(
      synced,
    );
    expect(ciEvents.at(-1)).toMatchObject({ sessionId, ci: { sha: synced, overall: 'failure' } });
    expect(api.log.filter((entry) => entry.includes(answered))).toStrictEqual([]);
  });

  test('invalidates a rejected token and retries once with the one gh gives now', async ({
    expect,
    services,
    opened,
    ciEvents,
    world,
  }) => {
    const { api, callsFile, writeScenario } = world;
    const sessionId = await opened();
    // Opening looks the stack up in the background; let it finish before rotating the token.
    await waitUntil(() => {
      return api.log.some((entry) => entry.includes('base=feature'));
    }, 'the stack lookup');
    writeScenario({
      hosts: { 'github.com': { token: 'gho_rotated', login: 'reviewer' } },
      callsFile,
    });
    api.validTokens.clear();
    api.validTokens.add('gho_rotated');
    await services.github.pollNow(sessionId);
    const tokenCalls = readFileSync(callsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[] })
      .filter((call) => call.args[1] === 'token');
    expect(tokenCalls).toHaveLength(2);
    expect(
      api.log.filter((entry) => entry === 'GET /repos/octo-org/hello-world/pulls/7'),
    ).toHaveLength(3);
    expect(ciEvents.at(-1)).toMatchObject({ sessionId });
  });

  test('describes the gh login, or why there is none, without a token', async ({
    expect,
    services,
    openPull,
    world,
  }) => {
    const { clone, token, callsFile, writeScenario } = world;
    expect(okValueFrom(await services.github.authStatus({}))).toStrictEqual({
      kind: 'signed-in',
      host: 'github.com',
      provider: 'gh-cli',
      login: 'reviewer',
      scopes: ['gist', 'read:org', 'repo'],
    });
    const signedOut = okValueFrom(await services.github.authStatus({ host: 'ghe.example.com' }));
    expect(signedOut).toStrictEqual({
      kind: 'signed-out',
      host: 'ghe.example.com',
      reason: 'host-not-configured',
      message:
        'gh is not signed in to ghe.example.com. Run `gh auth login --hostname ghe.example.com`.',
      remedy: 'gh auth login --hostname ghe.example.com',
    });
    expect(JSON.stringify(signedOut)).not.toContain(token);
    writeScenario({ hosts: {}, callsFile });
    await expect(openPull(clone.directory)).resolves.toMatchObject({
      kind: 'failed',
      failure: 'not-signed-in',
      remedy: 'gh auth login --hostname github.com',
    });
  });

  test('reads the pull request’s commits, reviews and comments, oldest first', async ({
    expect,
    services,
    opened,
    world,
  }) => {
    const { api, firstHead } = world;
    const sessionId = await opened();
    api.pullCommits.set(7, [
      {
        sha: firstHead,
        message: 'feature\n\nbody',
        login: 'octocat',
        authorName: 'Octo Cat',
        date: '2026-10-28T10:00:00Z',
      },
    ]);
    api.conversation.set(7, [
      { login: 'vic', body: 'Looks promising', createdAt: '2026-10-28T10:10:00Z' },
    ]);
    api.submittedReviews.set(7, [
      { ...reviewBy('APPROVED', firstHead), body: 'LGTM', submittedAt: '2026-10-28T10:20:00Z' },
    ]);
    const timeline = okValueFrom(await services.github.getTimeline(sessionId));
    expect(timeline).toMatchObject({ kind: 'timeline', isTruncated: false });
    expect('events' in timeline && timeline.events.map((event) => event.kind)).toStrictEqual([
      'commit',
      'comment',
      'review',
    ]);
    expect('events' in timeline && timeline.events[0]).toMatchObject({
      kind: 'commit',
      headline: 'feature',
      author: 'octocat',
    });
    expect('events' in timeline && timeline.events[2]).toMatchObject({
      kind: 'review',
      verdict: 'approved',
      author: 'rita',
      body: 'LGTM',
    });
  });

  test('answers a failure, not an error, when GitHub cannot be read', async ({
    expect,
    services,
    opened,
    world,
  }) => {
    const sessionId = await opened();
    world.api.pullRequests.delete(7);
    expect(okValueFrom(await services.github.getTimeline(sessionId))).toMatchObject({
      kind: 'failed',
    });
  });

  test('gives the pull request to the chat as intent', async ({
    expect,
    services,
    opened,
    world,
  }) => {
    const sessionId = await opened();
    const types: string[] = [];
    services.chat.onStream((event) => {
      types.push(event.type);
    });
    okValueFrom(await services.chat.ask({ sessionId, question: 'Why 42?' }));
    await waitUntil(() => {
      return types.includes('message');
    }, 'the answer to end');
    const [call] = world.claude.calls();
    expect(call?.stdin).toContain("## The author's stated intent");
    expect(call?.stdin).toContain('Make the answer right\n\nREQ-1: the answer is 42.');
  });

  test('opens only allow-listed links', async ({ expect, services }) => {
    await expect(
      services.github.openLink({ url: 'https://evil.example/x' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    await expect(
      services.github.openLink({ url: 'https://github.com/o/r' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-wired' },
    });
  });
});

/** A `fetch` that answers the first read of pull request 7 with `first` and later reads with `later`. */
/** Stages an inline issue on `app.ts` line 1, which the pull request's diff covers. */
async function stageNote(services: MainServices, sessionId: string): Promise<void> {
  okValueFrom(
    await services.ura.create({
      sessionId,
      anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
      severity: 'issue',
      title: 'Name the constant',
      body: '42 needs a name.',
    }),
  );
}

/** The author pushes a new commit to the pull request, and GitHub reports it. */
async function pushHead(world: GithubWorld, message: string): Promise<string> {
  const { upstream, bare, api } = world;
  upstream.write('app.ts', lines(['export const answer = 42;', `// ${message}`]));
  const head = await upstream.commit(message);
  await upstream.git('push', '--quiet', bare, 'feature:refs/pull/7/head');
  Object.assign(api.pullRequests.get(7) ?? {}, {
    headSha: head,
    updatedAt: '2026-10-28T11:00:00Z',
  });
  return head;
}

/** The opened session's id, or empty when the pull request did not open. */
function openedSessionId(response: OpenPullRequestResponse): string {
  if (response.kind === 'opened') {
    return response.session.id;
  }
  return '';
}

/** A fake GitHub fetch that holds review POSTs until `release`. */
interface HeldReviewPosts {
  readonly fetch: FakeGithubApi['fetch'];
  readonly arrived: Promise<undefined>;
  readonly release: () => void;
}

/** The pull request's head on its first GET, and on every later one. */
interface HeadRace {
  readonly first: string;
  readonly later: string;
}

/** A fake GitHub fetch that moves the pull request's head between GETs, and counts them. */
interface RacingFetch {
  readonly fetch: FakeGithubApi['fetch'];
  readonly pullGets: () => number;
}

/** Holds every review POST until `release`; `arrived` settles when the first one reaches GitHub. */
function holdReviewPosts(api: FakeGithubApi): HeldReviewPosts {
  const arrived = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const fetch = api.fetch;
  return {
    fetch: async (url, init): Promise<Response> => {
      if (init.method === 'POST' && url.endsWith('/reviews')) {
        arrived.resolve(undefined);
        await gate.promise;
      }
      return fetch(url, init);
    },
    arrived: arrived.promise,
    release: (): void => {
      gate.resolve(undefined);
    },
  };
}

function racingFetch(api: FakeGithubApi, { first, later }: HeadRace): RacingFetch {
  let pullGets = 0;
  const fetch = api.fetch;
  return {
    fetch: async (url, init): Promise<Response> => {
      const pull = api.pullRequests.get(7);
      if (pull !== undefined && url.endsWith('/pulls/7')) {
        pullGets += 1;
        if (pullGets === 1) {
          pull.headSha = first;
        } else {
          pull.headSha = later;
        }
      }
      return fetch(url, init);
    },
    pullGets: (): number => {
      return pullGets;
    },
  };
}

function reviewBy(state: 'CHANGES_REQUESTED' | 'APPROVED', commitSha: string): FakeSubmittedReview {
  return { reviewer: 'rita', state, commitSha, submittedAt: '2026-10-28T10:30:00Z' };
}

function appInfo(): AppInfo {
  return {
    name: 'beuve',
    version: '0.1.0',
    platform: 'linux',
    electronVersion: '45.1.0',
    chromeVersion: '140',
    nodeVersion: '24',
  };
}
