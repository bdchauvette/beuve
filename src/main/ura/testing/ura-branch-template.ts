import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

import { lines } from '../../testing/lines.ts';
import { appLines } from './app-lines.ts';

/** main: nothing much; feature adds `src/app.ts`. */
export function uraBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-ura: feature branch',
    build: async (repo): Promise<undefined> => {
      repo.write('README.md', lines(['# test']));
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('src/app.ts', lines(appLines()));
      await repo.commit('add app');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
