import { describe } from 'vitest';

import { countCommits } from './count-commits.ts';
import { deleteBranch } from './delete-branch.ts';
import { test } from './testing/test.ts';

describe('deleteBranch', () => {
  test('deletes a branch only while it is where the caller saw it', async ({
    expect,
    repo,
    repository,
  }) => {
    const base = await repo.commit('base');
    await repo.git('branch', 'review/x', base);
    repo.write('a.txt', 'a\n');
    const later = await repo.commit('later');
    await repo.git('branch', '--force', 'review/x', later);
    await expect(countCommits(repository, { from: base, to: later })).resolves.toStrictEqual({
      ok: true,
      value: 1,
    });

    await expect(
      deleteBranch(repository, { branch: 'review/x', expected: base }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'command-failed' },
    });
    await expect(repo.git('rev-parse', 'refs/heads/review/x')).resolves.toBe(later);
    await expect(
      deleteBranch(repository, { branch: 'review/x', expected: later }),
    ).resolves.toStrictEqual({ ok: true, value: undefined });
    await expect(repo.git('branch', '--list', 'review/x')).resolves.toBe('');
  });
});
