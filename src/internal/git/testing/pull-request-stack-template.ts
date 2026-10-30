import type { CommitSha } from '../object-id.ts';
import { buildPullRequestStack } from './build-pull-request-stack.ts';
import type { RepositoryTemplate } from './test-repository.ts';

/** The commits of {@link buildPullRequestStack}'s stack. */
export interface PullRequestStackCommits {
  readonly root: CommitSha;
  readonly pr1: readonly CommitSha[];
  readonly pr2: readonly CommitSha[];
  readonly pr3: readonly CommitSha[];
}

/** {@link buildPullRequestStack} as a template: built once per worker, `pr3` checked out. */
export const pullRequestStackTemplate: RepositoryTemplate<PullRequestStackCommits> = {
  name: 'pull-request-stack',
  build: (repo) => {
    const { root, pr1, pr2, pr3 } = buildPullRequestStack(repo);
    return { root, pr1, pr2, pr3 };
  },
};
