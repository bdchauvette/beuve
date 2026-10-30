import path from 'node:path';

import { describe } from 'vitest';

import { listWorktrees } from './list-worktrees.ts';
import { test } from './testing/test.ts';

describe('listWorktrees', () => {
  test('lists the main worktree and linked ones, including awkward paths', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const commit = await repo.commit('one');
    const linked = path.join(repo.scratch(), 'with space ü');
    await repo.git('worktree', 'add', '--quiet', '--detach', linked, commit);
    await expect(listWorktrees(git)).resolves.toStrictEqual({
      ok: true,
      value: [
        {
          path: repo.directory,
          head: commit,
          checkout: { kind: 'branch', ref: 'refs/heads/main' },
          locked: undefined,
          prunable: undefined,
        },
        {
          path: linked,
          head: commit,
          checkout: { kind: 'detached' },
          locked: undefined,
          prunable: undefined,
        },
      ],
    });
  });
});
