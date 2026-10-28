import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addWorktree } from './add-worktree.ts';
import { createTestRepository } from './create-test-repository.ts';
import type { TestRepository } from './create-test-repository.ts';
import { listWorktrees } from './list-worktrees.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { removeWorktree } from './remove-worktree.ts';

describe('removeWorktree', () => {
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

  it('removes clean worktrees, and dirty ones only with force', async () => {
    repo.write('a.txt', 'a\n');
    const commit = repo.commit('one');
    const added = await addWorktree(git, { root: repo.scratch(), commit });
    if (!added.ok) {
      throw new Error(added.error.kind);
    }
    writeFileSync(path.join(added.value.path, 'a.txt'), 'dirty\n');

    await expect(removeWorktree(git, added.value.path)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'command-failed' },
    });
    await expect(removeWorktree(git, added.value.path, { force: true })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    const remaining = await listWorktrees(git);
    expect(remaining.ok && remaining.value.map((worktree) => worktree.path)).toEqual([
      repo.directory,
    ]);
  });

  it('refuses relative paths and the main worktree', async () => {
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
