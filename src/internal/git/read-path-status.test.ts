import { describe } from 'vitest';

import { readPathStatus } from './read-path-status.ts';
import { test } from './testing/test.ts';

describe('readPathStatus', () => {
  test('sees unstaged and staged edits of a tracked file, not untracked ones', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', 'one\n');
    repo.write('b.txt', 'one\n');
    await repo.commit('first');
    await expect(readPathStatus(git, 'a.txt')).resolves.toStrictEqual({ ok: true, value: 'clean' });
    repo.write('a.txt', 'two\n');
    await expect(readPathStatus(git, 'a.txt')).resolves.toStrictEqual({
      ok: true,
      value: 'modified',
    });
    repo.write('b.txt', 'two\n');
    await repo.git('add', 'b.txt');
    await expect(readPathStatus(git, 'b.txt')).resolves.toStrictEqual({
      ok: true,
      value: 'modified',
    });
    repo.write('new.txt', 'untracked\n');
    await expect(readPathStatus(git, 'new.txt')).resolves.toStrictEqual({
      ok: true,
      value: 'clean',
    });
  });

  test('takes a pathspec-looking name literally', async ({ expect, repo, repository: git }) => {
    repo.write('*.txt', 'star\n');
    repo.write('a.txt', 'one\n');
    await repo.commit('first');
    repo.write('a.txt', 'two\n');
    await expect(readPathStatus(git, '*.txt')).resolves.toStrictEqual({ ok: true, value: 'clean' });
  });

  test('refuses an absolute or empty path', async ({ expect, repo, repository: git }) => {
    await expect(readPathStatus(git, repo.directory)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(readPathStatus(git, '')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
  });
});
