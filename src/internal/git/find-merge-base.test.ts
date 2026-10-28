import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './create-test-repository.ts';
import type { TestRepository } from './create-test-repository.ts';
import { findMergeBase } from './find-merge-base.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('findMergeBase', () => {
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

  it('finds the fork point of two branches', async () => {
    const fork = repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    const topic = repo.commit('topic');
    repo.git('switch', '--quiet', 'main');
    const main = repo.commit('main');
    await expect(findMergeBase(git, main, topic)).resolves.toEqual({ ok: true, value: fork });
  });

  it('reports unrelated histories', async () => {
    const main = repo.commit('main');
    repo.git('switch', '--quiet', '--orphan', 'other');
    const other = repo.commit('other');
    await expect(findMergeBase(git, main, other)).resolves.toEqual({
      ok: false,
      error: { kind: 'no-merge-base', left: main, right: other },
    });
  });
});
