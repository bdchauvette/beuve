import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { openTestRepository } from './open-test-repository.ts';
import type { TestRepository } from './test-repository.ts';

/**
 * Creates a repository on branch `main` at `<home>/repo`, with a local identity and signing off
 * (see `openTestRepository` for the isolation). `home` must exist and be symlink-free; its owner
 * removes it (a template directory under the worker's `tempRoot`). Tests get one from the `repo`
 * fixture instead (`./test.ts`), which copies a template rather than running `git init` each time.
 */
export async function createTestRepository(home: string): Promise<TestRepository> {
  mkdirSync(path.join(home, 'repo'));
  const repo = openTestRepository(home);
  await repo.git('init', '--quiet', '--initial-branch=main');
  await repo.git('config', 'user.name', 'Beuve Test');
  await repo.git('config', 'user.email', 'test@beuve.invalid');
  await repo.git('config', 'commit.gpgsign', 'false');
  await repo.git('config', 'tag.gpgsign', 'false');
  return repo;
}
