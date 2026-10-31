import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { listTreeBlobs } from './list-tree-blobs.ts';
import { readBlobs } from './read-blobs.ts';
import { hostilePathNames } from './testing/hostile-path-names.ts';
import { test } from './testing/test.ts';

describe('listTreeBlobs', () => {
  test('lists tracked files with blob names that readBlobs can read, paths unquoted', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('src/a b/ü.ts', 'export const a = 1;\n');
    repo.write('main.ts', 'export const b = 2;\n');
    const head = await repo.commit('first');

    const listed = await listTreeBlobs(git, head);
    expect(listed.ok).toBe(true);
    const listedValue = okValueFrom(listed);
    expect(listedValue.map((blob) => blob.path)).toStrictEqual(['main.ts', 'src/a b/ü.ts']);
    const blobs = await readBlobs(
      git,
      listedValue.map(({ objectId }) => ({ objectId })),
    );
    expect(blobs.ok && blobs.value.get(listedValue[1]?.objectId ?? '')).toMatchObject({
      kind: 'text',
      text: 'export const a = 1;\n',
    });
  });

  test('lists paths git would quote exactly as stored', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const names = hostilePathNames();
    for (const name of names) {
      repo.write(name, `${name}\n`);
    }
    const head = await repo.commit('hostile names');
    const listed = okValueFrom(await listTreeBlobs(git, head));
    expect(new Set(listed.map((blob) => blob.path))).toStrictEqual(new Set(names));
  });
});
