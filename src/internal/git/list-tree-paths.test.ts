import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { listTreePaths } from './list-tree-paths.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('listTreePaths', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('lists every tracked path of a commit, unquoted, without directories', async () => {
    repo.write('README.md', 'hi\n');
    repo.write('src/a b/ü.ts', 'x\n');
    repo.write('src/main.ts', 'y\n');
    const first = repo.commit('first');
    repo.write('later.txt', 'z\n');
    repo.commit('second');

    await expect(listTreePaths(git, first)).resolves.toEqual({
      ok: true,
      value: ['README.md', 'src/a b/ü.ts', 'src/main.ts'],
    });
  });

  it('fails for a commit the repository lacks', async () => {
    repo.write('a.txt', 'a\n');
    repo.commit('first');
    const missing = await listTreePaths(git, 'f'.repeat(40) as never);
    expect(missing.ok).toBe(false);
  });
});
