import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { addWorktree } from './add-worktree.ts';
import { listWorktrees } from './list-worktrees.ts';
import { removeWorktree } from './remove-worktree.ts';
import { test } from './testing/test.ts';

describe('removeWorktree', () => {
  test('removes clean worktrees, and dirty ones only with force', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', 'a\n');
    const commit = repo.commit('one');
    const added = okValueFrom(await addWorktree(git, { root: repo.scratch(), commit }));
    writeFileSync(path.join(added.path, 'a.txt'), 'dirty\n');

    await expect(removeWorktree(git, added.path)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'command-failed' },
    });
    await expect(removeWorktree(git, added.path, { force: true })).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    const remaining = await listWorktrees(git);
    expect(remaining.ok && remaining.value.map((worktree) => worktree.path)).toStrictEqual([
      repo.directory,
    ]);
  });

  test('refuses relative paths and the main worktree', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.commit('one');
    await expect(removeWorktree(git, 'relative')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(removeWorktree(git, repo.directory, { force: true })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument', reason: 'cannot remove the main worktree' },
    });
  });
});
