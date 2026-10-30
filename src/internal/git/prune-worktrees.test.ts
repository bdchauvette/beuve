import { rmSync } from 'node:fs';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { addWorktree } from './add-worktree.ts';
import { listWorktrees } from './list-worktrees.ts';
import { pruneWorktrees } from './prune-worktrees.ts';
import { test } from './testing/test.ts';

describe('pruneWorktrees', () => {
  test('forgets worktrees whose directories were deleted', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const commit = repo.commit('one');
    const added = okValueFrom(await addWorktree(git, { root: repo.scratch(), commit }));
    rmSync(added.path, { recursive: true, force: true });
    const before = await listWorktrees(git);
    expect(before.ok && before.value[1]?.prunable).toBeDefined();

    await expect(pruneWorktrees(git)).resolves.toStrictEqual({ ok: true, value: undefined });
    const after = await listWorktrees(git);
    expect(after.ok && after.value).toHaveLength(1);
  });
});
