import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectBranches } from './inspect-branches.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

describe('inspectBranches', () => {
  let repo: TestRepository;
  let git: GitRepository;

  beforeEach(async () => {
    repo = createTestRepository();
    repo.write('a.txt', 'a\n');
    repo.git('add', '--all');
    repo.git('commit', '--quiet', '--message', 'base', '--date', '2026-01-01T00:00:00Z');
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('lists branches newest first, with the current branch and main as the default base', async () => {
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('b.txt', 'b\n');
    repo.commit('feature');
    const inspected = await inspectBranches(git);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) {
      return;
    }
    expect(inspected.value.current).toBe('feature');
    expect(inspected.value.defaultBase).toBe('main');
    expect(inspected.value.branches.map((branch) => branch.name)).toEqual(['feature', 'main']);
    expect(inspected.value.branches.every((branch) => !branch.isRemote)).toBe(true);
  });

  it('prefers origin/HEAD and leaves remote HEAD symrefs out', async () => {
    const head = repo.git('rev-parse', 'HEAD');
    repo.git('update-ref', 'refs/remotes/origin/trunk', head);
    repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const inspected = await inspectBranches(git);
    expect(inspected.ok && inspected.value.defaultBase).toBe('origin/trunk');
    expect(
      inspected.ok &&
        inspected.value.branches
          .map((branch) => branch.name)
          .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['main', 'origin/trunk']);
  });

  it('has no current branch on a detached head', async () => {
    repo.git('switch', '--quiet', '--detach');
    const inspected = await inspectBranches(git);
    expect(inspected.ok && inspected.value.current).toBeUndefined();
  });
});
