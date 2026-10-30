import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { diffRange } from './diff-range.ts';
import { test } from './testing/test.ts';

describe('diffRange', () => {
  test('shows only the branch’s changes since its fork point, like a pull request', async ({
    expect,
    repo,
    repository: git,
  }) => {
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
    const resultValue = okValueFrom(result);
    expect(resultValue.files).toHaveLength(1);
  });
});
