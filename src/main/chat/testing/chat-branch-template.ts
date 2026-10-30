import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

/** `main` with `app.rs`; `feature` adds `feature.rs` (three lines). Leaves `main` checked out. */
export function chatBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-chat: feature branch',
    build: async (repo): Promise<undefined> => {
      repo.write('app.rs', 'fn main() {\n  run();\n}\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('feature.rs', 'pub fn feature() -> u8 {\n  1\n}\n');
      await repo.commit('add feature');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
