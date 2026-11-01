import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

/** A repository with `main` and a `feature` branch that changes one file. */
export function terminalTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-terminal: a feature branch',
    build: async (repo): Promise<undefined> => {
      repo.write('src/a.ts', 'export function a(): number {\n  return 1;\n}\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '-c', 'feature', 'main');
      repo.write('src/a.ts', 'export function a(): number {\n  return 2;\n}\n');
      await repo.commit('feature');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
