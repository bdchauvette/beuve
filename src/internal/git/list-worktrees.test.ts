import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './create-test-repository.ts';
import type { TestRepository } from './create-test-repository.ts';
import { listWorktrees } from './list-worktrees.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('listWorktrees', () => {
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

  it('lists the main worktree and linked ones, including awkward paths', async () => {
    const commit = repo.commit('one');
    const linked = path.join(repo.scratch(), 'with space ü');
    repo.git('worktree', 'add', '--quiet', '--detach', linked, commit);
    await expect(listWorktrees(git)).resolves.toEqual({
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
