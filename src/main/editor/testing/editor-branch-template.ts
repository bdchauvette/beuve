import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

/** `main` with `app.ts`; `feature` adds `src/feature.ts` (three lines). Leaves `main` checked out. */
export function editorBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-editor: feature branch',
    build: async (repo): Promise<undefined> => {
      repo.write('app.ts', 'one\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('src/feature.ts', 'a\nb\nc\n');
      await repo.commit('add feature');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
