import { describe } from 'vitest';

import { listTreePaths } from './list-tree-paths.ts';
import { test } from './testing/test.ts';

describe('listTreePaths', () => {
  test('lists every tracked path of a commit, unquoted, without directories', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('README.md', 'hi\n');
    repo.write('src/a b/ü.ts', 'x\n');
    repo.write('src/main.ts', 'y\n');
    const first = await repo.commit('first');
    repo.write('later.txt', 'z\n');
    await repo.commit('second');

    await expect(listTreePaths(git, first)).resolves.toStrictEqual({
      ok: true,
      value: ['README.md', 'src/a b/ü.ts', 'src/main.ts'],
    });
  });

  test('fails for a commit the repository lacks', async ({ expect, repo, repository: git }) => {
    repo.write('a.txt', 'a\n');
    await repo.commit('first');
    const missing = await listTreePaths(git, 'f'.repeat(40) as never);
    expect(missing.ok).toBe(false);
  });
});
