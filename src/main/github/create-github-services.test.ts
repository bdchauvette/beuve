import { readFileSync } from 'node:fs';

import { describe } from 'vitest';

import type { FakeGithubApi } from '#internal/github/testing/create-fake-github-api.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { lines } from '../testing/lines.ts';
import { waitUntil } from '../testing/wait-until.ts';
import { test } from './testing/test.ts';

describe('GitHub pull request sessions (integration: fake GitHub, fake gh, local bare remote)', () => {
  test('opens a pull request into a local clone, idempotently, and remembers the clone', async ({
    expect,
    services,
    openPull,
    repositories,
    world,
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
    expect(again.kind === 'opened' && first.kind === 'opened' && again.session.id).toBe(
      first.kind === 'opened' && first.session.id,
    );
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

    const sessionId = first.kind === 'opened' ? first.session.id : '';
    const review = okValueFrom(await services.sessions.getReview({ sessionId }));
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
  }) => {
    const { upstream, clone, bare, firstHead, api } = world;
    await upstream.git('commit', '--quiet', '--amend', '--message', 'feature, amended');
    const amended = await upstream.git('rev-parse', 'HEAD');
    await upstream.git('push', '--quiet', '--force', bare, 'feature:refs/pull/7/head');
    const racing = racingFetch(api, firstHead, amended);
    Object.assign(api, { fetch: racing.fetch });
    const restarted = recreate(services);
    const result = okValueFrom(
      await restarted.github.openPullRequest({
        ref: 'https://github.com/octo-org/hello-world/pull/7/files',
        repoPath: clone.directory,
      }),
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
  }) => {
    const { upstream, bare, firstHead, api } = world;
    const sessionId = await opened();
    const reviewed = okValueFrom(await services.sessions.getReview({ sessionId }));
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
    const interdiff = okValueFrom(await services.sessions.getReview({ sessionId }));
    expect(interdiff.headSha).toBe(secondHead);
    expect(interdiff.scope).toMatchObject({
      kind: 'interdiff',
      fromHeadSha: firstHead,
      outcome: { kind: 'exact' },
    });
    expect(interdiff.files.map((file) => file.path)).toStrictEqual(['app.ts']);
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

    expect(okValueFrom(await services.github.previewReview({ sessionId }))).toStrictEqual({
      sessionId,
      headSha: firstHead,
      verdict: 'comment',
      inlineCount: 1,
      bodyCount: 1,
      alreadyPostedCount: 0,
    });

    api.viewer = 'octocat';
    expect(
      okValueFrom(await services.github.postReview({ sessionId, verdict: 'request-changes' })),
    ).toMatchObject({
      kind: 'failed',
      failure: 'own-pull-request',
    });
    api.viewer = 'reviewer';

    const posted = okValueFrom(await services.github.postReview({ sessionId }));
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
    const listed = okValueFrom(await ura.list({ sessionId }));
    expect(listed.items.map((item) => item.posted?.placement)).toStrictEqual(['inline', 'body']);

    expect(okValueFrom(await services.github.previewReview({ sessionId }))).toMatchObject({
      inlineCount: 0,
      bodyCount: 0,
      alreadyPostedCount: 2,
    });

    okValueFrom(
      await ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
        severity: 'nit',
        title: 'Trailing comment',
        body: 'Off the diff, says GitHub.',
      }),
    );
    api.rejectCommentPaths.add('app.ts');
    const fallback = okValueFrom(await services.github.postReview({ sessionId }));
    expect(fallback).toMatchObject({
      kind: 'posted',
      inlineCount: 0,
      bodyCount: 1,
      movedToBody: 1,
    });
    expect(api.reviews).toHaveLength(2);
    expect(api.reviews[1]?.body.comments).toStrictEqual([]);
    expect(api.reviews[1]?.body.body).toContain('Comments GitHub could not attach to the diff');
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
    await waitUntil(
      () => api.log.some((entry) => entry.includes('base=feature')),
      'the stack lookup',
    );
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

  test('gives the pull request to the chat as intent and to agents as metadata', async ({
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
    await waitUntil(() => types.includes('message'), 'the answer to end');
    const [call] = world.claude.calls();
    expect(call?.stdin).toContain("## The author's stated intent");
    expect(call?.stdin).toContain('Make the answer right\n\nREQ-1: the answer is 42.');

    const review = await services.mcpTools.readHumanReview({ sessionId });
    expect(review).toMatchObject({
      ok: true,
      value: {
        structured: {
          schema: 'beuve.ura/1',
          pullRequest: {
            number: 7,
            title: 'Make the answer right',
            url: expect.stringContaining('/pull/7') as string,
            state: 'open',
            author: 'octocat',
          },
        },
      },
    });
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
function racingFetch(
  api: FakeGithubApi,
  first: string,
  later: string,
): { readonly fetch: FakeGithubApi['fetch']; readonly pullGets: () => number } {
  let pullGets = 0;
  const fetch = api.fetch;
  return {
    fetch: async (url, init): Promise<Response> => {
      const pull = api.pullRequests.get(7);
      if (pull !== undefined && url.endsWith('/pulls/7')) {
        pullGets += 1;
        pull.headSha = pullGets === 1 ? first : later;
      }
      return fetch(url, init);
    },
    pullGets: () => pullGets,
  };
}

function reviewBy(
  state: 'CHANGES_REQUESTED' | 'APPROVED',
  commitSha: string,
): { reviewer: string; state: typeof state; commitSha: string; submittedAt: string } {
  return { reviewer: 'rita', state, commitSha, submittedAt: '2026-10-28T10:30:00Z' };
}
