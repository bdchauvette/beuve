import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import type { DiffFile } from './diff-model.ts';
import { diffObjects } from './diff-objects.ts';
import { snapshotWorktree } from './snapshot-worktree.ts';
import { test } from './testing/test.ts';

describe('snapshotWorktree', () => {
  test('captures staged, unstaged, untracked and deleted files, and touches nothing', async ({
    expect,
    repo,
    repository,
    tempDir,
    signal,
  }) => {
    repo.write('.gitignore', 'ignored.log\n');
    repo.write('keep.txt', 'keep\n');
    repo.write('gone.txt', 'gone\n');
    repo.write('staged.txt', 'one\n');
    repo.write('same-size.txt', 'abc\n');
    const base = await repo.commit('base');
    await writeFile(path.join(repo.directory, 'keep.txt'), 'changed\n', { signal });
    await writeFile(path.join(repo.directory, 'staged.txt'), 'two\n', { signal });
    await repo.git('add', 'staged.txt');
    await rm(path.join(repo.directory, 'gone.txt'));
    await writeFile(path.join(repo.directory, 'new.txt'), 'new\n', { signal });
    await writeFile(path.join(repo.directory, 'same-size.txt'), 'xyz\n', { signal });
    await writeFile(path.join(repo.directory, 'ignored.log'), 'noise\n', { signal });
    const statusBefore = await repo.git('status', '--porcelain');
    const indexBefore = await readFile(path.join(repo.directory, '.git', 'index'), { signal });

    const scratch = await mkdtemp(path.join(tempDir, 'snapshot-'));
    const tree = okValueFrom(await snapshotWorktree(repository, scratch));
    const files = okValueFrom(await diffObjects(repository, { from: base, to: tree }));
    expect(files.map((file) => describeChange(file))).toStrictEqual([
      ['deleted', 'gone.txt'],
      ['modified', 'keep.txt'],
      ['added', 'new.txt'],
      ['modified', 'same-size.txt'],
      ['modified', 'staged.txt'],
    ]);
    await expect(
      readFile(path.join(repo.directory, '.git', 'index'), { signal }),
    ).resolves.toStrictEqual(indexBefore);
    await expect(repo.git('status', '--porcelain')).resolves.toBe(statusBefore);
    await expect(repo.git('rev-parse', 'HEAD')).resolves.toBe(base);
  });
});

function describeChange(file: DiffFile): readonly string[] {
  if ('path' in file) {
    return [file.status, file.path];
  }
  return [file.status, file.newPath];
}
