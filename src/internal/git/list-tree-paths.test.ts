import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { listTreePaths } from './list-tree-paths.ts';
import { hostilePathNames } from './testing/hostile-path-names.ts';
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

  test('lists paths git would quote exactly as stored', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const names = hostilePathNames();
    for (const name of names) {
      repo.write(name, 'x\n');
    }
    const head = await repo.commit('hostile names');
    const listed = okValueFrom(await listTreePaths(git, head));
    expect(new Set(listed)).toStrictEqual(new Set(names));
  });

  test('fails for a commit the repository lacks', async ({ expect, repo, repository: git }) => {
    repo.write('a.txt', 'a\n');
    await repo.commit('first');
    const missing = await listTreePaths(git, 'f'.repeat(40) as never);
    expect(missing.ok).toBe(false);
  });
});
