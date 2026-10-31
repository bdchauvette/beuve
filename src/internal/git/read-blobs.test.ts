import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { readBlobs } from './read-blobs.ts';
import { test } from './testing/test.ts';

describe('readBlobs', () => {
  test('reads text, flags binary, oversized, missing and non-blob objects', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.ts', 'export const a = "é";\n');
    repo.write('empty.txt', '');
    repo.write('image.bin', new Uint8Array([0x89, 0x50, 0x00, 0x01, 0x0a]));
    repo.write('big.txt', 'x'.repeat(200));
    const commit = await repo.commit('files');
    const blob = async (file: string): Promise<string> => {
      return await repo.git('rev-parse', `${commit}:${file}`);
    };
    const tree = await repo.git('show', '--no-patch', '--format=%T', commit);
    const missing = 'f'.repeat(40);

    const result = await readBlobs(
      git,
      [
        { objectId: await blob('a.ts') },
        { objectId: await blob('a.ts'), mode: '100644' },
        { objectId: await blob('empty.txt') },
        { objectId: await blob('image.bin') },
        { objectId: await blob('big.txt') },
        { objectId: missing },
        { objectId: tree },
        { objectId: commit, mode: '160000' },
      ],
      { maxBlobBytes: 100 },
    );
    expect(result.ok).toBe(true);
    const contents = okValueFrom(result);
    expect(contents.get(await blob('a.ts'))).toStrictEqual({
      kind: 'text',
      text: 'export const a = "é";\n',
      size: 23,
    });
    expect(contents.get(await blob('empty.txt'))).toStrictEqual({
      kind: 'text',
      text: '',
      size: 0,
    });
    expect(contents.get(await blob('image.bin'))).toStrictEqual({ kind: 'binary', size: 5 });
    expect(contents.get(await blob('big.txt'))).toStrictEqual({
      kind: 'too-large',
      size: 200,
      limit: 100,
    });
    expect(contents.get(missing)).toStrictEqual({ kind: 'missing' });
    expect(contents.get(tree)).toStrictEqual({ kind: 'not-a-blob', type: 'tree' });
    expect(contents.get(commit)).toStrictEqual({ kind: 'submodule' });
  });

  test('reads many blobs in one pass, byte-exact', async ({ expect, repo, repository: git }) => {
    const texts = Array.from({ length: 300 }, (_, index) => {
      return `line ${String(index)}\n`.repeat(index);
    });
    for (const [index, text] of texts.entries()) {
      repo.write(`f${String(index)}.txt`, text);
    }
    const commit = await repo.commit('many');
    const listing = await repo.git('ls-tree', '-r', '--format=%(objectname) %(path)', commit);
    const ids = listing.split('\n').map((row) => row.split(' ') as [string, string]);
    const result = await readBlobs(
      git,
      ids.map(([objectId]) => {
        return { objectId };
      }),
    );
    expect(result.ok).toBe(true);
    for (const [objectId, file] of ids) {
      const index = Number(file.slice(1, -4));
      expect(result.ok && result.value.get(objectId)).toMatchObject({ text: texts[index] });
    }
  });

  test('refuses abbreviated ids and needs no git for an empty request', async ({
    expect,
    repository: git,
  }) => {
    await expect(readBlobs(git, [{ objectId: 'abc123' }])).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(readBlobs(git, [])).resolves.toStrictEqual({ ok: true, value: new Map() });
  });
});
