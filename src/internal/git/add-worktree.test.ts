import { chmodSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addWorktree } from './add-worktree.ts';
import { createTestRepository } from './create-test-repository.ts';
import type { TestRepository } from './create-test-repository.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('addWorktree', () => {
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

  it('checks a commit out detached under the root, idempotently', async () => {
    repo.write('a.txt', 'one\n');
    const commit = repo.commit('one');
    repo.write('a.txt', 'two\n');
    repo.commit('two');
    const root = path.join(repo.scratch(), 'worktrees', 'nested');

    const added = await addWorktree(git, { root, commit });
    expect(added).toMatchObject({
      ok: true,
      value: { head: commit, checkout: { kind: 'detached' } },
    });
    if (!added.ok) {
      return;
    }
    expect(added.value.path.startsWith(root)).toBe(true);
    expect(path.basename(added.value.path)).toBe(commit);
    expect(readFileSync(path.join(added.value.path, 'a.txt'), 'utf8')).toBe('one\n');

    await expect(addWorktree(git, { root, commit })).resolves.toEqual(added);
  });

  it('does not run repository hooks', async () => {
    const commit = repo.commit('one');
    const marker = path.join(repo.scratch(), 'hook-ran');
    repo.write('.git/hooks/post-checkout', `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(path.join(repo.directory, '.git/hooks/post-checkout'), 0o755);
    await expect(addWorktree(git, { root: repo.scratch(), commit })).resolves.toMatchObject({
      ok: true,
    });
    expect(existsSync(marker)).toBe(false);
  });

  it('reports a worktree at the planned path that moved to another commit', async () => {
    const first = repo.commit('one');
    const second = repo.commit('two');
    const root = repo.scratch();
    const added = await addWorktree(git, { root, commit: first });
    if (!added.ok) {
      throw new Error(added.error.kind);
    }
    repo.git('-C', added.value.path, 'checkout', '--quiet', '--detach', second);
    await expect(addWorktree(git, { root, commit: first })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'worktree-conflict', path: added.value.path },
    });
  });

  it('requires an absolute root', async () => {
    const commit = repo.commit('one');
    await expect(addWorktree(git, { root: 'relative', commit })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
  });
});
