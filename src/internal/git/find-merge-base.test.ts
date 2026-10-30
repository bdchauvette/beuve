import { describe } from 'vitest';

import { findMergeBase } from './find-merge-base.ts';
import { test } from './testing/test.ts';

describe('findMergeBase', () => {
  test('finds the fork point of two branches', async ({ expect, repo, repository: git }) => {
    const fork = await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'topic');
    const topic = await repo.commit('topic');
    await repo.git('switch', '--quiet', 'main');
    const main = await repo.commit('main');
    await expect(findMergeBase(git, main, topic)).resolves.toStrictEqual({ ok: true, value: fork });
  });

  test('reports unrelated histories', async ({ expect, repo, repository: git }) => {
    const main = await repo.commit('main');
    await repo.git('switch', '--quiet', '--orphan', 'other');
    const other = await repo.commit('other');
    await expect(findMergeBase(git, main, other)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no-merge-base', left: main, right: other },
    });
  });
});
