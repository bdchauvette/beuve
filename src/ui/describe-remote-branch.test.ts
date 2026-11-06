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

/** Pull request 7 of `fullName`, `owner/repo`. */
function pull(fullName: string): NonNullable<RemoteBranchView['pullRequest']> {
  const [owner = '', repo = ''] = fullName.split('/', 2);
  return { owner, repo, number: 7, htmlUrl: 'https://x' };
}

test.for<[string, RemoteBranchView, string, string]>([
  ['a followed branch', branch(), 'ok', 'Following claude/fix'],
  ['a deleted branch', { ...branch(), state: 'gone' }, 'warn', 'claude/fix is gone from GitHub'],
  [
    'a pull request reviewed elsewhere',
    { ...branch(), pullRequest: { ...pull('o/r'), sessionId: 's2' } },
    'muted',
    'claude/fix · PR #7 has its own review',
  ],
  [
    'an upstream pull request reviewed elsewhere',
    { ...branch(), pullRequest: { ...pull('up/r'), sessionId: 's2' } },
    'muted',
    'claude/fix · PR up/r#7 has its own review',
  ],
  [
    'an upstream pull request the clone has no remote for',
    { ...branch(), pullRequest: { ...pull('up/r\u{202E}'), needsRemote: true } },
    'warn',
    'claude/fix · PR up/r⟨U+202E⟩#7 is open; add a remote for up/r⟨U+202E⟩ to review it as a pull request',
  ],
  [
    'a pull request about to be promoted to',
    { ...branch(), pullRequest: pull('up/r') },
    'ok',
    'Following claude/fix',
  ],
])('describeRemoteBranch shows %s', ([, view, tone, text], { expect }) => {
  expect(describeRemoteBranch(view)).toMatchObject({ tone, text });
  expect(describeRemoteBranch(view).title).toContain('nothing is posted');
});
