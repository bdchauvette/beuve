import path from 'node:path';

import { describe } from 'vitest';

import type { OpenRemoteBranchResponse, RemoteBranchUpdatedView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../main-services.ts';
import { lines } from '../testing/lines.ts';
import { test } from './testing/test.ts';
import type { GithubWorld } from './testing/test.ts';

describe('remote-branch sessions (ADR 0112; integration: fake GitHub, local bare remote)', () => {
  test('follows a branch without a pull request, moves its head, then promotes it in place', async ({
    expect,
    services,
    updates,
    world,
    signal,
  }) => {
    const { clone, upstream, bare, api, baseSha, firstHead } = world;
    const events = recordBranchEvents(services);
    await publishBranch(world, firstHead);

    const opened = await openBranch(services, clone.directory);
    expect(opened).toMatchObject({
      kind: 'opened',
      repoPath: clone.directory,
      session: {
        headSha: firstHead,
        source: {
          kind: 'remote-branch',
          forge: 'github',
          host: 'github.com',
          owner: 'octo-org',
          repo: 'hello-world',
          branch: 'claude/fix',
        },
      },
      branch: { state: 'present', defaultBranch: 'main', headSha: firstHead },
    });
    const sessionId = openedId(opened);
    const baseRef = baseRefOf(opened);
    expect(baseRef).toMatch(/^refs\/beuve\/branch\/[\da-f]{24}\/base$/u);
    await expect(clone.git('rev-parse', baseRef)).resolves.toBe(baseSha);
    await expect(clone.git('for-each-ref', 'refs/remotes')).resolves.toBe('');
    expect(okValueFrom(services.sessions.list())).toMatchObject([
      { id: sessionId, remoteBranch: { state: 'present', defaultBranch: 'main' } },
    ]);
    await expect(openBranch(services)).resolves.toMatchObject({ session: { id: sessionId } });

    const full = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(full.files.map((file) => file.path)).toStrictEqual(['app.ts', 'notes.md']);
    okValueFrom(await services.sessions.markReviewed({ sessionId, expectedHeadSha: firstHead }));

    await services.github.pollNow(sessionId);
    expect(events).toStrictEqual([]);

    upstream.write('app.ts', lines(['export const answer = 42;', 'export const other = 3;']));
    const secondHead = await upstream.commit('fixup');
    await publishBranch(world, secondHead);
    await services.github.pollNow(sessionId);
    expect(events.at(-1)).toMatchObject({
      sessionId,
      headMoved: true,
      promoted: false,
      branch: { headSha: secondHead, state: 'present' },
    });
    const interdiff = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(interdiff.scope).toMatchObject({ kind: 'interdiff', fromHeadSha: firstHead });
    expect(interdiff.files.map((file) => file.path)).toStrictEqual(['app.ts']);

    await upstream.git('push', '--quiet', bare, `${secondHead}:refs/pull/7/head`);
    Object.assign(api.pullRequests.get(7) ?? {}, { headRef: 'claude/fix', headSha: secondHead });
    for (let poll = 0; poll < 5; poll += 1) {
      await services.github.pollNow(sessionId);
    }
    expect(events.filter((event) => event.promoted)).toHaveLength(1);
    expect(updates.at(-1)).toMatchObject({ sessionId, pullRequest: { number: 7 } });
    const promoted = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(promoted.session).toMatchObject({
      id: sessionId,
      headSha: secondHead,
      lastReviewedSha: firstHead,
      source: { kind: 'github-pull-request', number: 7, baseRef: 'refs/beuve/pr/7/base' },
    });
    expect(okValueFrom(services.sessions.list())).toHaveLength(1);
    expect(okValueFrom(await services.github.getPullRequest(sessionId))).toMatchObject({
      pullRequest: { number: 7 },
    });
  });

  test('marks a deleted branch gone, keeps the review, and resumes when it is back', async ({
    expect,
    services,
    world,
    signal,
  }) => {
    const { clone, api, firstHead } = world;
    const events = recordBranchEvents(services);
    await publishBranch(world, firstHead);
    const sessionId = openedId(await openBranch(services, clone.directory));
    okValueFrom(await services.sessions.markReviewed({ sessionId, expectedHeadSha: firstHead }));

    api.branches.delete('claude/fix');
    await services.github.pollNow(sessionId);
    expect(events.at(-1)).toMatchObject({ sessionId, branch: { state: 'gone' }, headMoved: false });
    await services.github.pollNow(sessionId);
    expect(events).toHaveLength(1);
    expect(okValueFrom(services.sessions.list())).toMatchObject([
      {
        id: sessionId,
        headSha: firstHead,
        lastReviewedSha: firstHead,
        remoteBranch: { state: 'gone' },
      },
    ]);
    expect(
      okValueFrom(await services.sessions.getReview({ sessionId }, { signal })).scope,
    ).toMatchObject({
      kind: 'up-to-date',
    });

    api.branches.set('claude/fix', firstHead);
    await services.github.pollNow(sessionId);
    expect(events.at(-1)).toMatchObject({ branch: { state: 'present' } });
  });

  test('leaves the branch session alone when its pull request already has a session', async ({
    expect,
    services,
    openPull,
    world,
  }) => {
    const { clone, api, firstHead } = world;
    const events = recordBranchEvents(services);
    await publishBranch(world, firstHead);
    const pull = api.pullRequests.get(7);
    api.pullRequests.delete(7);
    const sessionId = openedId(await openBranch(services, clone.directory));
    api.pullRequests.set(7, { ...(pull ?? fail()), headRef: 'claude/fix' });
    const pullSession = await openPull(clone.directory);
    expect(pullSession).toMatchObject({ kind: 'opened' });

    await services.github.pollNow(sessionId);
    const kinds = okValueFrom(services.sessions.list()).map((summary) => {
      return [summary.source.kind, summary.id] as const;
    });
    expect(events.at(-1)).toMatchObject({
      sessionId,
      promoted: false,
      branch: {
        pullRequest: {
          number: 7,
          htmlUrl: 'https://github.com/octo-org/hello-world/pull/7',
          sessionId: new Map(kinds).get('github-pull-request'),
        },
      },
    });
    expect(new Map(kinds).get('remote-branch')).toBe(sessionId);
    expect(kinds).toHaveLength(2);
  });

  test('opens the pull request instead when the branch already has one', async ({
    expect,
    services,
    world,
  }) => {
    const { clone, api, firstHead } = world;
    await publishBranch(world, firstHead);
    Object.assign(api.pullRequests.get(7) ?? {}, { headRef: 'claude/fix' });
    const opened = await openBranch(services, clone.directory);
    expect(opened).toMatchObject({
      kind: 'opened',
      session: { source: { kind: 'github-pull-request', number: 7 } },
    });
    expect(opened).not.toHaveProperty('branch');
  });

  test('links the head commit’s Claude-Session, and refuses what is not a branch', async ({
    expect,
    services,
    world,
    signal,
  }) => {
    const { clone, upstream } = world;
    upstream.write('agent.md', 'done\n');
    const agentHead = await upstream.commit(
      'agent work\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_42',
    );
    await publishBranch(world, agentHead);
    const opened = await openBranch(services, clone.directory);
    expect(opened).toMatchObject({
      branch: { agentSessionUrl: 'https://claude.ai/code/session_42' },
    });
    const read = await services.github.getBranch(openedId(opened));
    expect(okValueFrom(read).branch.agentSessionUrl).toBe('https://claude.ai/code/session_42');

    await expect(
      services.github.openBranch({ ref: 'https://github.com/o/r/pull/3' }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'failed', failure: 'invalid-ref' } });
    await expect(
      services.github.openBranch(
        { ref: 'octo-org/hello-world:missing', repoPath: clone.directory },
        { signal },
      ),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'failed', failure: 'not-found' } });
  });
});

describe('remote-branch sessions on a fork (ADR 0112 amendment: pull requests from forks)', () => {
  test('finds the pull request a fork’s branch opened upstream and promotes to it', async ({
    expect,
    services,
    world,
    signal,
  }) => {
    const { api, firstHead } = world;
    await addFork(world);
    const events = recordBranchEvents(services);
    const opened = await openForkBranch(services, world.clone.directory);
    expect(opened).toMatchObject({
      kind: 'opened',
      session: { source: { kind: 'remote-branch', owner: 'forker', repo: 'hello-world' } },
      branch: { owner: 'forker', headSha: firstHead },
    });
    expect(opened).not.toHaveProperty('branch.pullRequest');
    const sessionId = openedId(opened);
    okValueFrom(await services.sessions.markReviewed({ sessionId, expectedHeadSha: firstHead }));

    await openForkPullRequest(world);
    await services.github.pollNow(sessionId);
    expect(api.log).toContain(
      'GET /repos/octo-org/hello-world/pulls?state=open&head=forker%3Aclaude%2Ffix&per_page=100',
    );
    expect(events).toMatchObject([
      {
        sessionId,
        promoted: true,
        branch: { owner: 'forker', pullRequest: { owner: 'octo-org', number: 8, sessionId } },
      },
    ]);
    const promoted = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(promoted.session).toMatchObject({
      id: sessionId,
      lastReviewedSha: firstHead,
      source: {
        kind: 'github-pull-request',
        owner: 'octo-org',
        repo: 'hello-world',
        number: 8,
        baseRef: 'refs/beuve/pr/8/base',
      },
    });
    expect(okValueFrom(services.sessions.list())).toHaveLength(1);
  });

  test('opens the upstream pull request instead when the fork’s branch already has one', async ({
    expect,
    services,
    world,
  }) => {
    await addFork(world);
    await openForkPullRequest(world);
    await expect(openForkBranch(services, world.clone.directory)).resolves.toMatchObject({
      kind: 'opened',
      session: { source: { kind: 'github-pull-request', owner: 'octo-org', number: 8 } },
    });
  });

  test('without a remote for the upstream, keeps following and promotes once one is added', async ({
    expect,
    services,
    world,
    signal,
  }) => {
    const { clone } = world;
    await addFork(world);
    await clone.git('remote', 'remove', 'origin');
    await openForkPullRequest(world);
    const events = recordBranchEvents(services);
    const opened = await openForkBranch(services, clone.directory);
    expect(opened).toMatchObject({
      kind: 'opened',
      session: { source: { kind: 'remote-branch', owner: 'forker' } },
      branch: {
        pullRequest: {
          owner: 'octo-org',
          repo: 'hello-world',
          number: 8,
          htmlUrl: 'https://github.com/octo-org/hello-world/pull/8',
          needsRemote: true,
        },
      },
    });
    const sessionId = openedId(opened);

    await services.github.pollNow(sessionId);
    expect(events).toStrictEqual([]);
    const branch = okValueFrom(await services.github.getBranch(sessionId)).branch;
    expect(branch.pullRequest).toMatchObject({ number: 8, needsRemote: true });
    await expect(clone.git('remote')).resolves.toBe('fork');

    await clone.git('remote', 'add', 'origin', 'https://github.com/octo-org/hello-world.git');
    await services.github.pollNow(sessionId);
    expect(events).toMatchObject([{ sessionId, promoted: true }]);
    const promoted = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(promoted.session.source).toMatchObject({
      kind: 'github-pull-request',
      owner: 'octo-org',
      number: 8,
    });
  });

  test('leaves a fork’s branch session alone when the upstream pull request has a session', async ({
    expect,
    services,
    world,
    signal,
  }) => {
    await addFork(world);
    const events = recordBranchEvents(services);
    const sessionId = openedId(await openForkBranch(services, world.clone.directory));
    await openForkPullRequest(world);
    const pullSession = okValueFrom(
      await services.github.openPullRequest(
        { ref: 'octo-org/hello-world#8', repoPath: world.clone.directory },
        { signal },
      ),
    );
    expect(pullSession).toMatchObject({ kind: 'opened' });

    await services.github.pollNow(sessionId);
    const ids = okValueFrom(services.sessions.list()).map((summary) => summary.id);
    expect(ids).toHaveLength(2);
    expect(events).toMatchObject([
      {
        sessionId,
        promoted: false,
        branch: {
          pullRequest: {
            owner: 'octo-org',
            number: 8,
            sessionId: ids.find((id) => id !== sessionId),
          },
        },
      },
    ]);
  });
});

/**
 * Forks the world's repository as `forker/hello-world`: a second bare remote holding `main` and
 * `claude/fix` at the first head, the fake API's fork, and the clone's `fork` remote for it.
 */
async function addFork(world: GithubWorld): Promise<void> {
  const { upstream, clone, api, baseSha, firstHead } = world;
  const bare = path.join(path.dirname(world.bare), 'fork.git');
  const url = 'https://github.com/forker/hello-world.git';
  await upstream.git('init', '--quiet', '--bare', bare);
  await upstream.git(
    'push',
    '--quiet',
    bare,
    `${baseSha}:refs/heads/main`,
    `${firstHead}:refs/heads/claude/fix`,
  );
  await clone.git('remote', 'add', 'fork', url);
  await clone.git('config', `url.${bare}.insteadOf`, url);
  api.forks.set('forker/hello-world', {
    owner: 'forker',
    repo: 'hello-world',
    branches: new Map([['claude/fix', firstHead]]),
  });
}

/** Opens pull request 8 from `forker:claude/fix` into the world's repository. */
async function openForkPullRequest(world: GithubWorld): Promise<void> {
  await world.upstream.git('push', '--quiet', world.bare, `${world.firstHead}:refs/pull/8/head`);
  const pull = world.api.pullRequests.get(7) ?? fail();
  world.api.pullRequests.set(8, {
    ...pull,
    number: 8,
    headRef: 'claude/fix',
    headSha: world.firstHead,
    headRepository: { owner: 'forker', repo: 'hello-world' },
  });
}

async function openForkBranch(
  services: MainServices,
  repoPath: string,
): Promise<OpenRemoteBranchResponse> {
  return okValueFrom(
    await services.github.openBranch({
      ref: 'https://github.com/forker/hello-world/tree/claude/fix',
      repoPath,
    }),
  );
}

/** Pushes `sha` to the bare remote's `claude/fix` and tells the fake API. */
async function publishBranch(world: GithubWorld, sha: string): Promise<void> {
  await world.upstream.git(
    'push',
    '--quiet',
    '--force',
    world.bare,
    `${sha}:refs/heads/claude/fix`,
  );
  world.api.branches.set('claude/fix', sha);
}

async function openBranch(
  services: MainServices,
  repoPath?: string,
): Promise<OpenRemoteBranchResponse> {
  return okValueFrom(
    await services.github.openBranch({
      ref: 'https://github.com/octo-org/hello-world/tree/claude/fix',
      ...(repoPath !== undefined && { repoPath }),
    }),
  );
}

function recordBranchEvents(services: MainServices): RemoteBranchUpdatedView[] {
  const events: RemoteBranchUpdatedView[] = [];
  services.github.onBranchUpdated((event) => {
    events.push(event);
  });
  return events;
}

function openedId(response: OpenRemoteBranchResponse): string {
  if (response.kind !== 'opened') {
    throw new Error(`${response.failure}: ${response.message}`);
  }
  return response.session.id;
}

function baseRefOf(response: OpenRemoteBranchResponse): string {
  if (response.kind !== 'opened') {
    throw new Error(response.message);
  }
  return response.session.source.baseRef;
}

function fail(): never {
  throw new Error('the world has no pull request 7');
}
