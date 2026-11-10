import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

/** A Node repository on GitHub (by its `origin`), with `main` and a `feature` branch. */
export function setupTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-setup: a Node repository with a GitHub origin',
    build: async (repo): Promise<undefined> => {
      repo.write('package.json', '{ "name": "widgets" }\n');
      repo.write('package-lock.json', '{ "lockfileVersion": 3 }\n');
      repo.write('src/a.ts', 'export const a = 1;\n');
      await repo.commit('base');
      await repo.git('remote', 'add', 'origin', 'git@github.com:Acme/Widgets.git');
      await repo.git('switch', '--quiet', '-c', 'feature', 'main');
      repo.write('src/a.ts', 'export const a = 2;\n');
      await repo.commit('feature');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
