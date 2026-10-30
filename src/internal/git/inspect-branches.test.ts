import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { inspectBranches } from './inspect-branches.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import type { TestRepository } from './testing/test-repository.ts';
import type { TestRepositories } from './testing/test.ts';
import { test } from './testing/test.ts';

describe('inspectBranches', () => {
  test('lists branches newest first, with the current branch and main as the default base', async ({
    expect,
    repositories,
  }) => {
    const { repo, git } = await datedBase(repositories);
    await repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('b.txt', 'b\n');
    await repo.commit('feature');
    const inspected = await inspectBranches(git);
    expect(inspected.ok).toBe(true);
    const inspectedValue = okValueFrom(inspected);
    expect(inspectedValue.current).toBe('feature');
    expect(inspectedValue.defaultBase).toBe('main');
    expect(inspectedValue.branches.map((branch) => branch.name)).toStrictEqual(['feature', 'main']);
    expect(inspectedValue.branches.every((branch) => !branch.isRemote)).toBe(true);
  });

  test('prefers origin/HEAD and leaves remote HEAD symrefs out', async ({
    expect,
    repositories,
  }) => {
    const { repo, git } = await datedBase(repositories);
    const head = await repo.git('rev-parse', 'HEAD');
    await repo.git('update-ref', 'refs/remotes/origin/trunk', head);
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const inspected = await inspectBranches(git);
    expect(inspected.ok && inspected.value.defaultBase).toBe('origin/trunk');
    expect(
      inspected.ok &&
        inspected.value.branches
          .map((branch) => branch.name)
          .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(['main', 'origin/trunk']);
  });

  test('has no current branch on a detached head', async ({ expect, repositories }) => {
    const { repo, git } = await datedBase(repositories);
    await repo.git('switch', '--quiet', '--detach');
    const inspected = await inspectBranches(git);
    expect(inspected.ok && inspected.value.current).toBeUndefined();
  });
});

/** A repository whose `main` has one commit, `base`, dated 2026-01-01 (a template). */
async function datedBase(
  repositories: TestRepositories,
): Promise<{ readonly repo: TestRepository; readonly git: GitRepository }> {
  const { repo } = await repositories.fromTemplate({
    name: 'inspect-branches: dated base',
    build: async (template): Promise<void> => {
      template.write('a.txt', 'a\n');
      await template.git('add', '--all');
      await template.git(
        'commit',
        '--quiet',
        '--message',
        'base',
        '--date',
        '2026-01-01T00:00:00Z',
      );
    },
  });
  return { repo, git: okValueFrom(await openRepository(repo.directory)) };
}
