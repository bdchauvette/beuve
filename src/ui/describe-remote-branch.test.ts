import type { RemoteBranchView } from '#contract/ipc-contract.ts';

import { describeRemoteBranch } from './describe-remote-branch.ts';
import { test } from './testing/test.ts';

function branch(): RemoteBranchView {
  return {
    host: 'github.com',
    owner: 'o',
    repo: 'r',
    branch: 'claude/fix',
    defaultBranch: 'main',
    headSha: 'a'.repeat(40),
    state: 'present',
    htmlUrl: 'https://github.com/o/r/tree/claude/fix',
  };
}

test.for<[string, RemoteBranchView, string, string]>([
  ['a followed branch', branch(), 'ok', 'Following claude/fix'],
  ['a deleted branch', { ...branch(), state: 'gone' }, 'warn', 'claude/fix is gone from GitHub'],
  [
    'a pull request reviewed elsewhere',
    { ...branch(), pullRequest: { number: 7, htmlUrl: 'https://x', sessionId: 's2' } },
    'muted',
    'claude/fix · PR #7 has its own review',
  ],
])('describeRemoteBranch shows %s', ([, view, tone, text], { expect }) => {
  expect(describeRemoteBranch(view)).toMatchObject({ tone, text });
  expect(describeRemoteBranch(view).title).toContain('nothing is posted');
});
