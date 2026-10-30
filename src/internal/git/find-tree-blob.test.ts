import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { findTreeBlob } from './find-tree-blob.ts';
import { test } from './testing/test.ts';

describe('findTreeBlob', () => {
  test('finds the blob at a path of a commit, and nothing for directories or absent paths', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('src/a b/ü.ts', 'x\n');
    repo.write('src/main.ts', 'y\n');
    const first = await repo.commit('first');
    repo.write('src/main.ts', 'changed\n');
    await repo.commit('second');

    const found = okValueFrom(await findTreeBlob(git, first, 'src/a b/ü.ts'));
    expect(found).toMatchObject({ path: 'src/a b/ü.ts', mode: '100644' });
    expect(found?.objectId).toMatch(/^[0-9a-f]{40,64}$/u);
    const [atFirst, missing, directory, glob] = await Promise.all([
      findTreeBlob(git, first, 'src/main.ts'),
      findTreeBlob(git, first, 'src/none.ts'),
      findTreeBlob(git, first, 'src'),
      findTreeBlob(git, first, 'src/*.ts'),
    ]);
    expect(okValueFrom(atFirst)?.objectId).not.toBe(found?.objectId);
    expect([missing, directory, glob].map((result) => okValueFrom(result))).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
