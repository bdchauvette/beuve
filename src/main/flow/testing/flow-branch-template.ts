import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

import { lines } from '../../testing/lines.ts';
import { flowSource } from './flow-source.ts';

/** `main` with a flow function; `feature` changes it, a JSON file and a new file, and drops the README. */
export function flowBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-flow: feature branch',
    build: async (repo): Promise<undefined> => {
      repo.write('README.md', lines(['# test']));
      repo.write('src/flow.ts', lines(flowSource('item * 2', 'total += 4')));
      repo.write('src/data.json', '{}\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('src/flow.ts', lines(flowSource('item', 'total += 5')));
      repo.write('src/data.json', '{ "a": 1 }\n');
      repo.write('src/gone.ts', lines(['export function gone(): void {', '  return;', '}']));
      await repo.commit('change flow');
      await repo.git('rm', '--quiet', 'README.md');
      await repo.commit('drop readme');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
