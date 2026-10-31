import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { removeTree } from '#x/fs/remove-tree.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { addBranchWorktree } from './add-branch-worktree.ts';
import { test } from './testing/test.ts';

describe('addBranchWorktree', () => {
  test('creates the branch at the base and checks it out writable, 0700', async ({
    expect,
    repo,
    repository,
  }) => {
    repo.write('a.txt', 'one\n');
    const base = await repo.commit('one');
    repo.write('a.txt', 'two\n');
    await repo.commit('two');
    const root = path.join(repo.scratch(), 'edits');
    const added = okValueFrom(
      await addBranchWorktree(repository, { root, branch: 'review/pr-7', base }),
    );
    expect(added).toMatchObject({ branch: 'review/pr-7', createdBranch: true });
    expect(path.basename(added.path)).toMatch(/^review-pr-7-[\da-f]{8}$/u);
    expect(readFileSync(path.join(added.path, 'a.txt'), 'utf8')).toBe('one\n');
    expect(statSync(added.path).mode & 0o777).toBe(0o700);
    writeFileSync(path.join(added.path, 'a.txt'), 'edited\n');
    await expect(repo.git('rev-parse', 'refs/heads/review/pr-7')).resolves.toBe(base);
    await expect(repo.git('config', '--get', 'branch.review/pr-7.remote')).rejects.toThrow(
      'Command failed',
    );

    await expect(
      addBranchWorktree(repository, { root, branch: 'review/pr-7', base }),
    ).resolves.toStrictEqual({ ok: true, value: { ...added, createdBranch: false } });
  });

  test('checks an existing branch out again, commits intact, after its directory went', async ({
    expect,
    repo,
    repository,
  }) => {
    const base = await repo.commit('base');
    const root = path.join(repo.scratch(), 'edits');
    const first = okValueFrom(
      await addBranchWorktree(repository, { root, branch: 'review/s', base }),
    );
    writeFileSync(path.join(first.path, 'b.txt'), 'b\n');
    await repo.git('-C', first.path, 'add', 'b.txt');
    await repo.git('-C', first.path, 'commit', '--quiet', '-m', 'mine');
    await removeTree(first.path);
    const again = okValueFrom(
      await addBranchWorktree(repository, { root, branch: 'review/s', base }),
    );
    expect(again).toStrictEqual({ ...first, createdBranch: false });
    expect(readFileSync(path.join(again.path, 'b.txt'), 'utf8')).toBe('b\n');
  });

  test('refuses a branch checked out elsewhere, and a name git rejects', async ({
    expect,
    repo,
    repository,
  }) => {
    const base = await repo.commit('base');
    const root = path.join(repo.scratch(), 'edits');
    await expect(
      addBranchWorktree(repository, { root, branch: 'main', base }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'worktree-conflict' } });
    await expect(
      addBranchWorktree(repository, { root, branch: 'review/bad..name', base }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
    await expect(
      addBranchWorktree(repository, { root, branch: '@{-1}', base }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
  });
});
