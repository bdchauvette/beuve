import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

/** `main` with two packages; `feature` edits `app.ts`, adds `services/api` and deletes `gone.ts`. */
export function filesBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-files: feature branch',
    build: async (repo): Promise<undefined> => {
      repo.write('package.json', '{}\n');
      repo.write('packages/web/package.json', '{}\n');
      repo.write('packages/web/src/app.ts', 'export const a = 1;\n');
      repo.write('packages/web/src/gone.ts', 'old\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('packages/web/src/app.ts', 'export const a = 2;\n');
      repo.write('services/api/go.mod', 'module api\n');
      await repo.git('rm', '--quiet', 'packages/web/src/gone.ts');
      await repo.commit('feature');
    },
  };
}
