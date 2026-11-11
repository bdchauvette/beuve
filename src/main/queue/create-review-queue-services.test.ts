import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';
import type { FakeGithubApi } from '#internal/github/testing/create-fake-github-api.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../github/testing/test.ts';

/**
 * Around the world's pull request 7, requested of the viewer's team `core`: a draft review
 * request of the viewer by name with changes requested and failing CI (8), the viewer's own pull
 * request stacked on 7 (9), a pull request from an agent branch (10), and three agent branches:
 * one ahead with a Claude-Session trailer, one merged, one with that pull request.
 */
function queueWorld(api: FakeGithubApi, firstHead: string): void {
  const open = 'is:open is:pr archived:false';
  const head8 = 'c'.repeat(40);
  api.pullRequests.set(8, {
    number: 8,
    title: 'Tidy the parser',
    body: '',
    author: 'octocat',
    headRef: 'tidy',
    headSha: head8,
    baseRef: 'main',
    baseSha: 'a'.repeat(40),
    isDraft: true,
    state: 'open',
    updatedAt: '2026-10-20T10:00:00Z',
    size: { additions: 12, deletions: 3, changedFiles: 2 },
  });
  api.submittedReviews.set(8, [
    {
      reviewer: 'rita',
      state: 'CHANGES_REQUESTED',
      commitSha: head8,
      submittedAt: '2026-10-21T10:00:00Z',
    },
  ]);
  api.checks.set(head8, [{ kind: 'check-run', name: 'test', result: 'failure' }]);
  api.pullRequests.set(9, {
    number: 9,
    title: 'Build on the answer',
    body: '',
    author: 'reviewer',
    headRef: 'on-top',
    headSha: 'd'.repeat(40),
    baseRef: 'feature',
    baseSha: firstHead,
    isDraft: false,
    state: 'open',
    updatedAt: '2026-10-22T10:00:00Z',
  });
  api.pullRequests.set(10, {
    number: 10,
    title: 'From an agent',
    body: '',
    author: 'claude',
    headRef: 'claude/has-pr',
    headSha: 'e'.repeat(40),
    baseRef: 'main',
    baseSha: 'a'.repeat(40),
    isDraft: false,
    state: 'open',
    updatedAt: '2026-10-22T10:00:00Z',
  });
  api.reviewRequestEvents.set(7, [
    { at: '2026-10-02T10:00:00Z', team: 'core' },
    { at: '2026-10-03T10:00:00Z', team: 'docs' },
    { at: '2026-10-04T10:00:00Z', reviewer: 'sam' },
  ]);
  api.reviewRequestEvents.set(8, [
    { at: '2026-10-05T10:00:00Z', reviewer: 'reviewer' },
    { at: '2026-10-06T10:00:00Z', team: 'core' },
    { at: '2026-10-07T10:00:00Z', reviewer: 'reviewer' },
  ]);
  api.viewerTeams = [{ organization: 'octo-org', slug: 'core' }];
  api.searches.set(`${open} review-requested:@me`, [7, 8]);
  api.searches.set(`${open} user-review-requested:@me`, [8]);
  api.searches.set(`${open} author:@me`, [9]);
  api.searchHeaders['x-github-sso'] = 'partial-results; organizations=21955855';
  api.searchHeaders['x-oauth-scopes'] = 'repo, gist';
  const ahead = '1'.repeat(40);
  const merged = '2'.repeat(40);
  api.branches.set('claude/fix-login', ahead);
  api.branches.set('claude/merged', merged);
  api.branches.set('claude/has-pr', 'e'.repeat(40));
  api.branches.set('main', 'a'.repeat(40));
  api.comparisons.set(ahead, {
    aheadBy: 2,
    commits: [
      {
        sha: '3'.repeat(40),
        message: 'Start the fix',
        login: 'claude',
        authorName: 'Claude',
        date: '2026-10-23T09:00:00Z',
      },
      {
        sha: ahead,
        message:
          'Fix the login\n\nClaude-Session: https://claude.ai/code/session_1\nCo-Authored-By: Claude <noreply@anthropic.com>',
        login: 'claude',
        authorName: 'Claude',
        date: '2026-10-23T10:00:00Z',
        committedAt: '2026-10-23T11:00:00Z',
      },
    ],
    files: [
      { additions: 5, deletions: 1 },
      { additions: 2, deletions: 2 },
    ],
  });
  api.comparisons.set(merged, { aheadBy: 0, commits: [], files: [] });
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function byKey(items: readonly ReviewQueueItemView[]): ReadonlyMap<string, ReviewQueueItemView> {
  return new Map(
    items.map((item) => {
      return [item.key, item];
    }),
  );
}

describe('the review queue (integration: fake GitHub, fake gh, a session database)', () => {
  test('merges review requests, own pull requests, agent branches and local review state', async ({
    expect,
    services,
    world,
    opened,
    tempDir,
  }) => {
    queueWorld(world.api, world.firstHead);
    const sessionId = await opened();
    const settingsFile = path.join(tempDir, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as {
      githubClonePaths: Record<string, string>;
    };
    settings.githubClonePaths['github.com/octo-org/vanished'] = '/nowhere';
    writeFileSync(settingsFile, JSON.stringify(settings));

    const queue = okValueFrom(await services.queue.refresh());
    const items = byKey(queue.items);
    expect(items.keys().toArray().toSorted(compareText)).toStrictEqual([
      'github.com/octo-org/hello-world:claude/fix-login',
      'github.com/octo-org/hello-world#7',
      'github.com/octo-org/hello-world#8',
      'github.com/octo-org/hello-world#9',
    ]);
    expect(items.get('github.com/octo-org/hello-world#7')).toMatchObject({
      kind: 'pull-request',
      reasons: ['requested'],
      request: 'team',
      branch: 'feature',
      headSha: world.firstHead,
      local: { state: 'opened', sessionId, markedFiles: 0 },
      waitingSince: '2026-10-02T10:00:00Z',
      waitingSinceSource: 'requested',
      stack: { id: 'github.com/octo-org/hello-world#7', depth: 0, size: 2, position: 0 },
    });
    expect(items.get('github.com/octo-org/hello-world#8')).toMatchObject({
      reasons: ['requested'],
      request: 'direct',
      isDraft: true,
      size: { additions: 12, deletions: 3, changedFiles: 2 },
      ci: { overall: 'failure', failing: 1 },
      attention: { turn: 'author' },
      local: { state: 'none' },
      waitingSince: '2026-10-07T10:00:00Z',
      waitingSinceSource: 'requested',
    });
    expect(items.get('github.com/octo-org/hello-world#9')).toMatchObject({
      reasons: ['authored'],
      author: 'reviewer',
      waitingSince: '2026-10-22T10:00:00Z',
      waitingSinceSource: 'updated',
      stack: { id: 'github.com/octo-org/hello-world#7', depth: 1, size: 2, position: 1 },
    });
    expect(items.get('github.com/octo-org/hello-world:claude/fix-login')).toStrictEqual({
      key: 'github.com/octo-org/hello-world:claude/fix-login',
      kind: 'branch',
      forge: 'github',
      host: 'github.com',
      owner: 'octo-org',
      repo: 'hello-world',
      branch: 'claude/fix-login',
      baseBranch: 'main',
      headSha: '1'.repeat(40),
      size: { additions: 7, deletions: 3, changedFiles: 2 },
      title: 'Fix the login',
      author: 'claude',
      isDraft: false,
      htmlUrl: 'https://github.com/octo-org/hello-world/tree/claude/fix-login',
      createdAt: '2026-10-23T09:00:00Z',
      updatedAt: '2026-10-23T10:00:00Z',
      waitingSince: '2026-10-23T11:00:00Z',
      waitingSinceSource: 'pushed',
      ci: { overall: 'none', failing: 0 },
      attention: { turn: 'you', reasons: ['an agent branch has no pull request yet'] },
      reasons: ['branch'],
      agentSessionUrl: 'https://claude.ai/code/session_1',
      local: { state: 'none' },
    });
    expect(
      queue.problems.map(({ kind, source }) => `${kind} ${source}`).toSorted(compareText),
    ).toStrictEqual([
      'failed github.com/octo-org/vanished branches',
      'scopes github.com search',
      'sso github.com search',
    ]);
    expect(queue.refreshedAt).toBeDefined();
    expect(queue.isRefreshing).toBe(false);
  });

  test('a second refresh asks only conditional questions of what did not change', async ({
    expect,
    services,
    world,
  }) => {
    queueWorld(world.api, world.firstHead);
    okValueFrom(await services.queue.refresh());
    const before = world.api.log.length;
    const second = okValueFrom(await services.queue.refresh());
    const asked = world.api.log.slice(before);
    expect(asked.filter((line) => /\/pulls\/\d+$/u.test(line))).toStrictEqual([]);
    expect(asked.filter((line) => line.includes('/compare/'))).toStrictEqual([]);
    expect(asked.filter((line) => /\/events|\/user\/teams/u.test(line))).toStrictEqual([]);
    expect(asked.filter((line) => line.includes('/pulls?'))).toStrictEqual([
      'GET /repos/octo-org/hello-world/pulls?state=open&sort=updated&direction=desc&per_page=100',
    ]);
    expect(second.items).toHaveLength(3);

    Object.assign(world.api.pullRequests.get(8) ?? {}, {
      updatedAt: '2026-10-24T10:00:00Z',
      isDraft: false,
    });
    const mark = world.api.log.length;
    const third = okValueFrom(await services.queue.refresh());
    expect(
      world.api.log.slice(mark).filter((line) => /\/pulls\/\d+$|\/events/u.test(line)),
    ).toStrictEqual([
      'GET /repos/octo-org/hello-world/pulls/8',
      'GET /repos/octo-org/hello-world/issues/8/events?per_page=100',
    ]);
    expect(byKey(third.items).get('github.com/octo-org/hello-world#8')).toMatchObject({
      isDraft: false,
    });
  });

  test('without the viewer’s teams, a team request waits since the latest team request', async ({
    expect,
    services,
    world,
  }) => {
    queueWorld(world.api, world.firstHead);
    world.api.viewerTeams = undefined;
    const queue = okValueFrom(await services.queue.refresh());
    expect(byKey(queue.items).get('github.com/octo-org/hello-world#7')).toMatchObject({
      waitingSince: '2026-10-03T10:00:00Z',
      waitingSinceSource: 'requested',
    });
    expect(queue.problems.map(({ kind }) => kind).toSorted(compareText)).toStrictEqual([
      'scopes',
      'sso',
    ]);
  });

  test('keeps a stack whole: its unqueued members are context rows, read lightly', async ({
    expect,
    services,
    world,
  }) => {
    queueWorld(world.api, world.firstHead);
    const open = 'is:open is:pr archived:false';
    world.api.pullRequests.set(11, {
      number: 11,
      title: 'Top of the stack',
      body: '',
      author: 'octocat',
      headRef: 'top',
      headSha: 'f'.repeat(40),
      baseRef: 'on-top',
      baseSha: 'd'.repeat(40),
      isDraft: false,
      state: 'open',
      updatedAt: '2026-10-25T10:00:00Z',
    });
    world.api.pullRequests.set(12, {
      number: 12,
      title: 'Beside the top',
      body: '',
      author: 'octocat',
      headRef: 'beside',
      headSha: '9'.repeat(40),
      baseRef: 'on-top',
      baseSha: 'd'.repeat(40),
      isDraft: true,
      state: 'open',
      updatedAt: '2026-10-26T10:00:00Z',
    });
    world.api.searches.set(`${open} review-requested:@me`, [7, 11]);
    world.api.searches.set(`${open} user-review-requested:@me`, [11]);
    world.api.searches.set(`${open} author:@me`, []);

    const queue = okValueFrom(await services.queue.refresh());
    const items = byKey(queue.items);
    const id = 'github.com/octo-org/hello-world#7';
    expect(
      queue.items
        .map((item) => {
          const place = `${String(item.stack?.position)}/${String(item.stack?.size)}`;
          return `#${String(item.number)} ${place} ${String(item.isContext === true)}`;
        })
        .toSorted(compareText),
    ).toStrictEqual(['#11 2/4 false', '#12 3/4 true', '#7 0/4 false', '#9 1/4 true']);
    expect(items.get('github.com/octo-org/hello-world#9')).toStrictEqual({
      key: 'github.com/octo-org/hello-world#9',
      kind: 'pull-request',
      forge: 'github',
      host: 'github.com',
      owner: 'octo-org',
      repo: 'hello-world',
      number: 9,
      branch: 'on-top',
      baseBranch: 'feature',
      headSha: 'd'.repeat(40),
      title: 'Build on the answer',
      author: 'reviewer',
      isDraft: false,
      htmlUrl: 'https://github.com/octo-org/hello-world/pull/9',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-22T10:00:00Z',
      waitingSince: '2026-10-22T10:00:00Z',
      waitingSinceSource: 'updated',
      attention: {
        turn: 'unknown',
        reasons: ['not waiting on you: in the stack of one that is'],
      },
      reasons: [],
      stack: { id, depth: 1, size: 4, position: 1 },
      local: { state: 'none' },
      isContext: true,
    });
    expect(items.get('github.com/octo-org/hello-world#11')).toMatchObject({
      stack: { id, depth: 2, size: 4, position: 2 },
    });
    expect(items.get('github.com/octo-org/hello-world#12')).toMatchObject({
      isDraft: true,
      stack: { id, depth: 2, size: 4, position: 3 },
    });
    const asked = world.api.log.join('\n');
    expect(asked).not.toContain('/pulls/9');
    expect(asked).not.toContain(`/commits/${'d'.repeat(40)}`);
  });

  test('a signed-out host names its sign-in command once, in the message', async ({
    expect,
    services,
    world,
  }) => {
    queueWorld(world.api, world.firstHead);
    world.writeScenario({ hosts: {}, callsFile: world.callsFile });

    const queue = okValueFrom(await services.queue.refresh());
    const failures = queue.problems.filter(({ kind }) => kind === 'failed');
    expect(failures.length).toBeGreaterThan(0);
    expect(
      failures.map(({ message, remedy }) => {
        return { message, remedy };
      }),
    ).toContainEqual({
      message: 'Not signed in to github.com. Run `gh auth login --hostname github.com`.',
      remedy: undefined,
    });
  });

  test('pushes the snapshot as it starts and finishes refreshing', async ({
    expect,
    services,
    world,
  }) => {
    queueWorld(world.api, world.firstHead);
    const seen: boolean[] = [];
    services.queue.onUpdated((event) => {
      seen.push(event.isRefreshing);
    });
    await services.queue.refresh();
    expect(seen).toStrictEqual([true, false]);
  });
});
