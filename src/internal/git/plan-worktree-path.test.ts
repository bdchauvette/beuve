import { describe } from 'vitest';

import type { CommitSha } from './object-id.ts';
import type { RepositoryPath } from './open-repository.ts';
import { planWorktreePath } from './plan-worktree-path.ts';
import { test } from './testing/test.ts';

describe('planWorktreePath', () => {
  test('is deterministic and keyed by repository path and commit()', ({ expect }) => {
    const first = planWorktreePath('/data/worktrees', '/src/my repo' as RepositoryPath, commit());
    const again = planWorktreePath('/data/worktrees/', '/src/my repo' as RepositoryPath, commit());
    const other = planWorktreePath('/data/worktrees', '/other/my repo' as RepositoryPath, commit());
    expect(first).toStrictEqual(again);
    expect(first).toMatchObject({
      ok: true,
      value: expect.stringMatching(plannedPattern()) as unknown,
    });
    expect(other.ok && first.ok && other.value !== first.value).toBe(true);
  });

  test('sanitizes names that could escape or hide the directory', ({ expect }) => {
    const planned = planWorktreePath('/w', '/src/..' as RepositoryPath, commit());
    expect(planned).toMatchObject({
      ok: true,
      value: expect.stringMatching(digestOnlyPattern()) as unknown,
    });
  });

  test('requires an absolute root', ({ expect }) => {
    expect(planWorktreePath('relative', '/src/repo' as RepositoryPath, commit())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
  });
});

function commit(): CommitSha {
  return 'bf80669e332dc67a7c7f708cc431bcca4b28479c' as CommitSha;
}

function plannedPattern(): RegExp {
  return /^\/data\/worktrees\/my-repo-[\da-f]{12}\/bf80669e/u;
}

function digestOnlyPattern(): RegExp {
  return /^\/w\/[\da-f]{12}\//u;
}
