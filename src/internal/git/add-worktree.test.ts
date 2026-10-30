import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { addWorktree } from './add-worktree.ts';
import { test } from './testing/test.ts';

describe('addWorktree', () => {
  test('checks a commit out detached under the root, idempotently', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', 'one\n');
    const commit = await repo.commit('one');
    repo.write('a.txt', 'two\n');
    await repo.commit('two');
    const root = path.join(repo.scratch(), 'worktrees', 'nested');

    const added = await addWorktree(git, { root, commit });
    expect(added).toMatchObject({
      ok: true,
      value: { head: commit, checkout: { kind: 'detached' } },
    });
    const addedValue = okValueFrom(added);
    expect(addedValue.path.startsWith(root)).toBe(true);
    expect(path.basename(addedValue.path)).toBe(commit);
    expect(readFileSync(path.join(addedValue.path, 'a.txt'), 'utf8')).toBe('one\n');

    await expect(addWorktree(git, { root, commit })).resolves.toStrictEqual(added);
  });

  test('does not run repository hooks', async ({ expect, repo, repository: git }) => {
    const commit = await repo.commit('one');
    const marker = path.join(repo.scratch(), 'hook-ran');
    repo.write('.git/hooks/post-checkout', `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(path.join(repo.directory, '.git/hooks/post-checkout'), 0o755);
    await expect(addWorktree(git, { root: repo.scratch(), commit })).resolves.toMatchObject({
      ok: true,
    });
    expect(existsSync(marker)).toBe(false);
  });

  test('reports a worktree at the planned path that moved to another commit', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const first = await repo.commit('one');
    const second = await repo.commit('two');
    const root = repo.scratch();
    const added = okValueFrom(await addWorktree(git, { root, commit: first }));
    await repo.git('-C', added.path, 'checkout', '--quiet', '--detach', second);
    await expect(addWorktree(git, { root, commit: first })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'worktree-conflict', path: added.path },
    });
  });

  test('checks a worktree out again when its directory was deleted behind git', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', 'one\n');
    const commit = await repo.commit('one');
    const root = repo.scratch();
    const added = okValueFrom(await addWorktree(git, { root, commit }));
    rmSync(added.path, { recursive: true, force: true });
    await expect(addWorktree(git, { root, commit })).resolves.toMatchObject({
      ok: true,
      value: { path: added.path, head: commit },
    });
    expect(readFileSync(path.join(added.path, 'a.txt'), 'utf8')).toBe('one\n');
  });

  test('requires an absolute root', async ({ expect, repo, repository: git }) => {
    const commit = await repo.commit('one');
    await expect(addWorktree(git, { root: 'relative', commit })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
  });
});
