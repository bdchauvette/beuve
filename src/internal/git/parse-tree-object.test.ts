import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { gitRunner } from './git-runner.ts';
import { parseTreeObject } from './parse-tree-object.ts';
import { test } from './testing/test.ts';

describe('parseTreeObject', () => {
  test('parses a real tree object with every kind of entry', async ({
    expect,
    repo,
    repository,
    signal,
  }) => {
    repo.write('file.ts', 'x\n');
    repo.write('dir/inner.ts', 'y\n');
    repo.write('new\nline.ts', 'z\n');
    const commit = await repo.commit('tree');
    const read = okValueFrom(
      await repository[gitRunner].objects.read(
        { kind: 'ref', ref: commit, peel: 'tree' },
        { signal },
      ),
    );
    const bytes = 'bytes' in read ? read.bytes : Buffer.alloc(0);
    expect(parseTreeObject(bytes, 20)).toStrictEqual([
      { mode: '040000', name: 'dir', objectId: await repo.git('rev-parse', 'HEAD:dir') },
      { mode: '100644', name: 'file.ts', objectId: await repo.git('rev-parse', 'HEAD:file.ts') },
      {
        mode: '100644',
        name: 'new\nline.ts',
        objectId: await repo.git('rev-parse', 'HEAD:new\nline.ts'),
      },
    ]);
  });

  test('refuses bytes that are not a tree', ({ expect }) => {
    expect(parseTreeObject(Buffer.from('100644 a'), 20)).toBeUndefined();
    const badMode = Buffer.from('mode a\0'.padEnd(30, 'x'));
    expect(parseTreeObject(badMode, 20)).toBeUndefined();
    expect(parseTreeObject(Buffer.alloc(0), 20)).toStrictEqual([]);
  });
});
