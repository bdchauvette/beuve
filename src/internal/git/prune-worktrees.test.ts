import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addWorktree } from './add-worktree.ts';
import { createTestRepository } from './create-test-repository.ts';
import type { TestRepository } from './create-test-repository.ts';
import { listWorktrees } from './list-worktrees.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { pruneWorktrees } from './prune-worktrees.ts';

describe('pruneWorktrees', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('forgets worktrees whose directories were deleted', async () => {
    const commit = repo.commit('one');
    const added = await addWorktree(git, { root: repo.scratch(), commit });
    if (!added.ok) {
      throw new Error(added.error.kind);
    }
    rmSync(added.value.path, { recursive: true, force: true });
    const before = await listWorktrees(git);
    expect(before.ok && before.value[1]?.prunable).toBeDefined();

    await expect(pruneWorktrees(git)).resolves.toEqual({ ok: true, value: undefined });
    const after = await listWorktrees(git);
    expect(after.ok && after.value).toHaveLength(1);
  });
});
