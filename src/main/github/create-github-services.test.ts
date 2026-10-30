import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CiStatusChangedView,
  IpcResult,
  OpenPullRequestResponse,
  PullRequestUpdatedView,
} from '#contract/ipc-contract.ts';
import { createGhCliCredentialProvider } from '#internal/auth/create-gh-cli-credential-provider.ts';
import { writeFakeGh } from '#internal/auth/testing/write-fake-gh.ts';
import { writeFakeClaude } from '#internal/llm/testing/write-fake-claude.ts';
import type { FakeGhScenario } from '#internal/auth/testing/write-fake-gh.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import { createFakeGithubApi } from '#internal/github/testing/create-fake-github-api.ts';
import type { FakeGithubApi } from '#internal/github/testing/create-fake-github-api.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#x/log/create-logger.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';

const remoteUrl = 'https://github.com/octo-org/hello-world.git';
const token = 'gho_fake_token';

describe('GitHub pull request sessions (integration: fake GitHub, fake gh, local bare remote)', () => {
  let upstream: TestRepository;
  let clone: TestRepository;
  let bare: string;
  let scenarioFile: string;
  let chatFile: string;
  let callsFile: string;
  let api: FakeGithubApi;
  let db: DatabaseSync;
  let services: MainServices;
  let updates: PullRequestUpdatedView[];
  let ciEvents: CiStatusChangedView[];
  let baseSha: string;
  let firstHead: string;

  beforeEach(() => {
    upstream = createTestRepository();
    upstream.write('app.ts', lines(['export const answer = 1;', 'export const other = 2;']));
    baseSha = upstream.commit('base');
    upstream.git('switch', '--quiet', '-c', 'feature');
    upstream.write('app.ts', lines(['export const answer = 42;', 'export const other = 2;']));
    upstream.write('notes.md', 'why\n');
    firstHead = upstream.commit('feature');
    bare = path.join(upstream.scratch(), 'hello-world.git');
    execFileSync('git', ['init', '--quiet', '--bare', bare]);
    upstream.git('push', '--quiet', bare, `${baseSha}:refs/heads/main`, 'feature:refs/pull/7/head');

    clone = createTestRepository();
    clone.git('remote', 'add', 'origin', remoteUrl);
    clone.git('config', `url.${bare}.insteadOf`, remoteUrl);

    api = createFakeGithubApi();
    api.pullRequests.set(7, {
      number: 7,
      title: 'Make the answer right',
      body: 'REQ-1: the answer is 42.\n\nSee https://github.com/octo-org/hello-world/issues/1.',
      author: 'octocat',
      headRef: 'feature',
      headSha: firstHead,
      baseRef: 'main',
      baseSha,
      isDraft: false,
      state: 'open',
      updatedAt: '2026-10-28T10:00:00Z',
    });

    const scratch = upstream.scratch();
    callsFile = path.join(scratch, 'gh-calls.jsonl');
    scenarioFile = path.join(scratch, 'gh-scenario.json');
    writeScenario({ hosts: { 'github.com': { token, login: 'reviewer' } }, callsFile });
    const gh = writeFakeGh(scratch);
    chatFile = path.join(scratch, 'chat.json');
    writeFileSync(chatFile, JSON.stringify({ chunks: ['Because of REQ-1.'] }));

    db = openAppDatabase(':memory:');
    services = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      deps: steppingDeps(),
      worktreeRoot: path.join(scratch, 'worktrees'),
      claude: {
        command: process.execPath,
        leadingArgs: [writeFakeClaude(scratch), 'chat', chatFile],
        killGraceMs: 200,
      },
      github: {
        credentials: createGhCliCredentialProvider({
          command: process.execPath,
          leadingArgs: [gh, scenarioFile],
          inheritedEnv: { PATH: process.env['PATH'], HOME: scratch },
        }),
        fetch: api.fetch,
        settingsPath: path.join(scratch, 'settings.json'),
        polling: { scheduled: false },
      },
    });
    updates = [];
    ciEvents = [];
    services.github.onPullRequestUpdated((event) => {
      updates.push(event);
    });
    services.github.onCiStatus((event) => {
      ciEvents.push(event);
    });
  });

  afterEach(async () => {
    await services.dispose();
    db.close();
    upstream.cleanup();
    clone.cleanup();
  });

  const writeScenario = (scenario: FakeGhScenario): void => {
    writeFileSync(scenarioFile, JSON.stringify(scenario));
  };

  const openPull = async (repoPath?: string): Promise<OpenPullRequestResponse> =>
    value(
      await services.github.openPullRequest({
        ref: 'https://github.com/octo-org/hello-world/pull/7/files',
        ...(repoPath !== undefined && { repoPath }),
      }),
    );

  const opened = async (): Promise<string> => {
    const result = await openPull(clone.directory);
    if (result.kind !== 'opened') {
      throw new Error(`${result.failure}: ${result.message}`);
    }
    return result.session.id;
  };

  const recreate = (previous: MainServices): MainServices => {
    void previous.dispose();
    const scratch = upstream.scratch();
    const next = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      deps: steppingDeps(),
      worktreeRoot: path.join(scratch, 'worktrees'),
      github: {
        credentials: createGhCliCredentialProvider({
          command: process.execPath,
          leadingArgs: [writeFakeGh(scratch), scenarioFile],
          inheritedEnv: { PATH: process.env['PATH'], HOME: scratch },
        }),
        fetch: async (url, init) => api.fetch(url, init),
        polling: { scheduled: false },
      },
    });
    next.github.onPullRequestUpdated((event) => {
      updates.push(event);
    });
    next.github.onCiStatus((event) => {
      ciEvents.push(event);
    });
    return next;
  };

  it('opens a pull request into a local clone, idempotently, and remembers the clone', async () => {
    expect(await openPull()).toMatchObject({ kind: 'failed', failure: 'needs-local-clone' });
    const stranger = createTestRepository();
    try {
      expect(await openPull(stranger.directory)).toMatchObject({
        kind: 'failed',
        failure: 'needs-local-clone',
        message: expect.stringContaining(
          'has no remote for github.com/octo-org/hello-world',
        ) as string,
      });
    } finally {
      stranger.cleanup();
    }

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
    expect(clone.git('rev-parse', 'refs/beuve/pr/7/head')).toBe(firstHead);
    expect(clone.git('rev-parse', 'refs/beuve/pr/7/base')).toBe(baseSha);

    const again = await openPull();
    expect(again.kind === 'opened' && first.kind === 'opened' && again.session.id).toBe(
      first.kind === 'opened' && first.session.id,
    );
    expect(value(services.sessions.list())).toMatchObject([
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
    const review = value(await services.sessions.getReview({ sessionId }));
    expect(review.scope).toEqual({ kind: 'full' });
    expect(review.baseSha).toBe(baseSha);
    expect(review.files.map((file) => file.path)).toEqual(['app.ts', 'notes.md']);
    expect(value(await services.github.getPullRequest(sessionId))).toMatchObject({
      pullRequest: { number: 7, body: expect.stringContaining('REQ-1') as string },
    });
  });

  it('follows a force-push between the API answer and the fetch by asking GitHub again', async () => {
    upstream.git('commit', '--quiet', '--amend', '--message', 'feature, amended');
    const amended = upstream.git('rev-parse', 'HEAD');
    upstream.git('push', '--quiet', '--force', bare, 'feature:refs/pull/7/head');
    const pull = api.pullRequests.get(7);
    let pullGets = 0;
    const fetch = api.fetch;
    Object.assign(api, {
      fetch: async (url: string, init: RequestInit): Promise<Response> => {
        if (pull !== undefined && url.endsWith('/pulls/7')) {
          pullGets += 1;
          pull.headSha = pullGets === 1 ? firstHead : amended;
        }
        return fetch(url, init);
      },
    });
    services = recreate(services);
    const result = await openPull(clone.directory);
    expect(result).toMatchObject({ kind: 'opened', session: { headSha: amended } });
    expect(pullGets).toBe(2);
  });

  it('moves the head when polling sees a push, offering an interdiff, and rolls up CI with ETags', async () => {
    const sessionId = await opened();
    const reviewed = value(await services.sessions.getReview({ sessionId }));
    value(await services.sessions.markReviewed({ sessionId, expectedHeadSha: reviewed.headSha }));
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
    const secondHead = upstream.commit('fixup');
    upstream.git('push', '--quiet', bare, 'feature:refs/pull/7/head');
    const pull = api.pullRequests.get(7);
    if (pull !== undefined) {
      pull.headSha = secondHead;
      pull.updatedAt = '2026-10-28T11:00:00Z';
    }
    api.checks.set(secondHead, [{ kind: 'check-run', name: 'test', result: 'success' }]);
    await services.github.pollNow(sessionId);

    expect(updates.at(-1)).toMatchObject({
      sessionId,
      headMoved: true,
      pullRequest: { headSha: secondHead },
    });
    expect(ciEvents.at(-1)).toMatchObject({ ci: { sha: secondHead, overall: 'success' } });
    const interdiff = value(await services.sessions.getReview({ sessionId }));
    expect(interdiff.headSha).toBe(secondHead);
    expect(interdiff.scope).toMatchObject({
      kind: 'interdiff',
      fromHeadSha: firstHead,
      outcome: { kind: 'exact' },
    });
    expect(interdiff.files.map((file) => file.path)).toEqual(['app.ts']);
  });

  it('posts the staged items as one review, then only new ones, with the own-PR and off-diff fallbacks', async () => {
    const sessionId = await opened();
    const ura = services.ura;
    value(
      await ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
        severity: 'issue',
        title: 'Name the constant',
        body: '42 needs a name.',
      }),
    );
    value(
      await ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'notes.md' },
        severity: 'question',
        title: 'Why a notes file?',
        body: '',
      }),
    );

    expect(value(await services.github.previewReview({ sessionId }))).toEqual({
      sessionId,
      headSha: firstHead,
      verdict: 'comment',
      inlineCount: 1,
      bodyCount: 1,
      alreadyPostedCount: 0,
    });

    api.viewer = 'octocat';
    expect(
      value(await services.github.postReview({ sessionId, verdict: 'request-changes' })),
    ).toMatchObject({
      kind: 'failed',
      failure: 'own-pull-request',
    });
    api.viewer = 'reviewer';

    const posted = value(await services.github.postReview({ sessionId }));
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
    const listed = value(await ura.list({ sessionId }));
    expect(listed.items.map((item) => item.posted?.placement)).toEqual(['inline', 'body']);

    expect(value(await services.github.previewReview({ sessionId }))).toMatchObject({
      inlineCount: 0,
      bodyCount: 0,
      alreadyPostedCount: 2,
    });

    value(
      await ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
        severity: 'nit',
        title: 'Trailing comment',
        body: 'Off the diff, says GitHub.',
      }),
    );
    api.rejectCommentPaths.add('app.ts');
    const fallback = value(await services.github.postReview({ sessionId }));
    expect(fallback).toMatchObject({
      kind: 'posted',
      inlineCount: 0,
      bodyCount: 1,
      movedToBody: 1,
    });
    expect(api.reviews).toHaveLength(2);
    expect(api.reviews[1]?.body.comments).toEqual([]);
    expect(api.reviews[1]?.body.body).toContain('Comments GitHub could not attach to the diff');
  });

  it('invalidates a rejected token and retries once with the one gh gives now', async () => {
    const sessionId = await opened();
    // Opening looks the stack up in the background; let it finish before rotating the token.
    await vi.waitFor(() => {
      expect(api.log.some((entry) => entry.includes('base=feature'))).toBe(true);
    });
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

  it('describes the gh login, or why there is none, without a token', async () => {
    expect(value(await services.github.authStatus({}))).toEqual({
      kind: 'signed-in',
      host: 'github.com',
      provider: 'gh-cli',
      login: 'reviewer',
      scopes: ['gist', 'read:org', 'repo'],
    });
    const signedOut = value(await services.github.authStatus({ host: 'ghe.example.com' }));
    expect(signedOut).toEqual({
      kind: 'signed-out',
      host: 'ghe.example.com',
      reason: 'host-not-configured',
      message:
        'gh is not signed in to ghe.example.com. Run `gh auth login --hostname ghe.example.com`.',
      remedy: 'gh auth login --hostname ghe.example.com',
    });
    expect(JSON.stringify(signedOut)).not.toContain(token);
    writeScenario({ hosts: {}, callsFile });
    expect(await openPull(clone.directory)).toMatchObject({
      kind: 'failed',
      failure: 'not-signed-in',
      remedy: 'gh auth login --hostname github.com',
    });
  });

  it('gives the pull request to the chat as intent and to agents as metadata', async () => {
    const sessionId = await opened();
    const answered = new Promise<void>((resolve) => {
      services.chat.onMessageUpdated(() => {
        resolve();
      });
    });
    value(await services.chat.ask({ sessionId, question: 'Why 42?' }));
    await answered;
    const [call] = readFileSync(`${chatFile}.calls`, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { stdin: string });
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

  it('opens only allow-listed links', async () => {
    expect(await services.github.openLink({ url: 'https://evil.example/x' })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    expect(await services.github.openLink({ url: 'https://github.com/o/r' })).toMatchObject({
      ok: false,
      error: { code: 'not-wired' },
    });
  });
});

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function lines(content: readonly string[]): string {
  return `${content.join('\n')}\n`;
}

function steppingDeps(): SessionDeps {
  let tick = 0;
  let id = 0;
  return {
    now: (): Date => new Date(Date.UTC(2026, 9, 28, 12, 0, tick++)),
    newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
}
