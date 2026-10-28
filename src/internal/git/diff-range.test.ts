import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { diffRange } from './diff-range.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('diffRange', () => {
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

  it('shows only the branch’s changes since its fork point, like a pull request', async () => {
    repo.write('shared.txt', 'base\n');
    const fork = repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    repo.write('feature.txt', 'feature\n');
    const head = repo.commit('feature');
    repo.git('switch', '--quiet', 'main');
    repo.write('upstream.txt', 'upstream\n');
    const base = repo.commit('upstream');

    const result = await diffRange(git, { base, head });
    expect(result).toMatchObject({
      ok: true,
      value: {
        mergeBase: fork,
        range: { base, head },
        files: [{ status: 'added', path: 'feature.txt' }],
      },
    });
    if (result.ok) {
      expect(result.value.files).toHaveLength(1);
    }
  });
});
