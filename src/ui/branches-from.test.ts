import { describe } from 'vitest';

import type { PullRequestView, SessionSummary } from '#contract/ipc-contract.ts';

import { branchesFrom } from './branches-from.ts';
import { test } from './testing/test.ts';

describe('branchesFrom', () => {
  test('names a local review’s refs without refs/heads/', ({ expect }) => {
    const session = sessionOf({
      kind: 'local',
      repoPath: '/r',
      baseRef: 'main',
      headRef: 'refs/heads/feature/x',
    });
    expect(branchesFrom({ session, pullRequest: undefined })).toStrictEqual({
      head: 'feature/x',
      base: 'main',
    });
  });

  test('names a pull request’s branches once it is loaded', ({ expect }) => {
    const session = sessionOf({
      kind: 'github-pull-request',
      repoPath: '/r',
      baseRef: 'refs/beuve/pr/7/base',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      number: 7,
    });
    expect(branchesFrom({ session, pullRequest: undefined })).toBeUndefined();
    const pullRequest = { headBranch: 'fix', baseBranch: 'main' } as PullRequestView;
    expect(branchesFrom({ session, pullRequest })).toStrictEqual({ head: 'fix', base: 'main' });
  });

  test('names a followed branch, and its base once the default branch is known', ({ expect }) => {
    const source = {
      kind: 'remote-branch',
      repoPath: '/r',
      baseRef: 'refs/beuve/branch/k/base',
      forge: 'github',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      branch: 'agent/x',
    } as const;
    expect(branchesFrom({ session: sessionOf(source), pullRequest: undefined })).toStrictEqual({
      head: 'agent/x',
    });
    const known = {
      ...sessionOf(source),
      remoteBranch: { state: 'present', defaultBranch: 'main' },
    };
    expect(
      branchesFrom({ session: known as SessionSummary, pullRequest: undefined }),
    ).toStrictEqual({ head: 'agent/x', base: 'main' });
  });
});

function sessionOf(source: SessionSummary['source']): SessionSummary {
  return { id: 's1', source, headSha: 'a', createdAt: '', updatedAt: '' };
}
