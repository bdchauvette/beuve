import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

import { lines } from '../../testing/lines.ts';

/** The commits of {@link pullRequestTemplate}. */
export interface PullRequestCommits {
  readonly baseSha: string;
  readonly firstHead: string;
}

/** `main` with `app.ts`; `feature` (checked out) changes it and adds `notes.md`. */
export function pullRequestTemplate(): RepositoryTemplate<PullRequestCommits> {
  return {
    name: 'main-github: pull request 7',
    build: async (repo): Promise<PullRequestCommits> => {
      repo.write('app.ts', lines(['export const answer = 1;', 'export const other = 2;']));
      const baseSha = await repo.commit('base');
      await repo.git('switch', '--quiet', '-c', 'feature');
      repo.write('app.ts', lines(['export const answer = 42;', 'export const other = 2;']));
      repo.write('notes.md', 'why\n');
      const firstHead = await repo.commit('feature');
      return { baseSha, firstHead };
    },
  };
}
