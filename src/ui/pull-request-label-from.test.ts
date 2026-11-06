import type { RemoteBranchView } from '#contract/ipc-contract.ts';
import { test } from './testing/test.ts';

import { pullRequestLabelFrom } from './pull-request-label-from.ts';

function branch(): RemoteBranchView {
  return {
    host: 'github.com',
    owner: 'me',
    repo: 'app',
    branch: 'claude/fix',
    defaultBranch: 'main',
    headSha: 'a'.repeat(40),
    state: 'present',
    htmlUrl: 'https://github.com/me/app/tree/claude/fix',
  };
}

function pullRequest(
  fullName: `${string}/${string}`,
): NonNullable<RemoteBranchView['pullRequest']> {
  const [owner = '', repo = ''] = fullName.split('/', 2);
  return { owner, repo, number: 7, htmlUrl: `https://github.com/${fullName}/pull/7` };
}

test.for([
  ["the branch's own repository", pullRequest('me/app'), '#7'],
  ['its own repository in another case', pullRequest('Me/App'), '#7'],
  ['an upstream of its fork', pullRequest('up/app'), 'up/app#7'],
  ['an upstream with a control character', pullRequest('up/a\u{202E}b'), 'up/a⟨U+202E⟩b#7'],
] as const)('names a pull request in %s', ([, given, expected], { expect }) => {
  expect(pullRequestLabelFrom(branch(), given)).toBe(expected);
});
