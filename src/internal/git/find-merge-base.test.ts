import { describe } from 'vitest';

import { findMergeBase } from './find-merge-base.ts';
import { test } from './testing/test.ts';

describe('findMergeBase', () => {
  test('finds the fork point of two branches', async ({ expect, repo, repository: git }) => {
    const fork = repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    const topic = repo.commit('topic');
    repo.git('switch', '--quiet', 'main');
    const main = repo.commit('main');
    await expect(findMergeBase(git, main, topic)).resolves.toStrictEqual({ ok: true, value: fork });
  });

  test('reports unrelated histories', async ({ expect, repo, repository: git }) => {
    const main = repo.commit('main');
    repo.git('switch', '--quiet', '--orphan', 'other');
    const other = repo.commit('other');
    await expect(findMergeBase(git, main, other)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no-merge-base', left: main, right: other },
    });
  });
});
