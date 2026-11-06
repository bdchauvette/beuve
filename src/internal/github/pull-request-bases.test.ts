import type { RepositoryName } from './get-repository.ts';
import { pullRequestBases } from './pull-request-bases.ts';
import type { BranchLineage } from './pull-request-bases.ts';
import { test } from './testing/test.ts';

/** `fullName` (`owner/repo`), or `owner`'s `hello-world`. */
function name(fullName: string): RepositoryName {
  const [owner = '', repo = 'hello-world'] = fullName.split('/', 2);
  return { owner, repo };
}

test.for<[string, BranchLineage, readonly RepositoryName[]]>([
  [
    'a repository that is not a fork',
    { repository: name('octo-org'), parent: undefined, source: undefined },
    [name('octo-org')],
  ],
  [
    'a fork of a repository that is not a fork',
    { repository: name('forker'), parent: name('octo-org'), source: name('octo-org') },
    [name('forker'), name('octo-org')],
  ],
  [
    'a fork of a fork',
    { repository: name('forker'), parent: name('mid'), source: name('octo-org') },
    [name('forker'), name('mid'), name('octo-org')],
  ],
  [
    'names that differ only in case',
    {
      repository: name('forker'),
      parent: name('Octo-Org/Hello-World'),
      source: name('octo-org'),
    },
    [name('forker'), name('Octo-Org/Hello-World')],
  ],
  [
    'a renamed fork',
    { repository: name('forker/hw'), parent: name('octo-org'), source: name('octo-org') },
    [name('forker/hw'), name('octo-org')],
  ],
])('pullRequestBases asks %s', ([, lineage, expected], { expect }) => {
  expect(pullRequestBases(lineage)).toStrictEqual(expected);
});
