import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openTestRepository } from './open-test-repository.ts';
import type { TestRepository } from './test-repository.ts';

/**
 * Creates a repository on branch `main` at `<home>/repo`, with a local identity and signing off
 * (see `openTestRepository` for the isolation). `home` defaults to a new temporary directory;
 * a given one must exist and be symlink-free. Tests get one from the `repo` fixture instead
 * (`./test.ts`), which copies a template rather than running `git init` each time.
 */
export function createTestRepository(home = createHome()): TestRepository {
  mkdirSync(path.join(home, 'repo'));
  const repo = openTestRepository(home);
  repo.git('init', '--quiet', '--initial-branch=main');
  repo.git('config', 'user.name', 'Beuve Test');
  repo.git('config', 'user.email', 'test@beuve.invalid');
  repo.git('config', 'commit.gpgsign', 'false');
  repo.git('config', 'tag.gpgsign', 'false');
  return repo;
}

function createHome(): string {
  const prefix = path.join(os.tmpdir(), 'beuve-git-');
  return realpathSync(mkdtempSync(prefix));
}
