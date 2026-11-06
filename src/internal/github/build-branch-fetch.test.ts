import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

import { buildBranchFetch } from './build-branch-fetch.ts';
import type { BranchRef } from './branch-ref.ts';

function ref(branch: string): BranchRef {
  return { host: 'github.com', owner: 'Octo-Org', repo: '.github', branch };
}

describe('buildBranchFetch', () => {
  test('fetches the branch and the default branch under one hashed refs/beuve/branch/ key', ({
    expect,
  }) => {
    const plan = okValueFrom(buildBranchFetch({ ref: ref('claude/fix'), defaultBranch: 'main' }));
    expect(plan.headRef).toMatch(/^refs\/beuve\/branch\/[\da-f]{24}\/head$/u);
    expect(plan.baseRef).toBe(plan.headRef.replace(/head$/u, 'base'));
    expect(plan.refspecs).toStrictEqual([
      `+refs/heads/claude/fix:${plan.headRef}`,
      `+refs/heads/main:${plan.baseRef}`,
    ]);
  });

  test('keeps nested branch names apart and ignores the case of the repository', ({ expect }) => {
    const outer = okValueFrom(buildBranchFetch({ ref: ref('a'), defaultBranch: 'main' }));
    const inner = okValueFrom(buildBranchFetch({ ref: ref('a/b'), defaultBranch: 'main' }));
    const lower = okValueFrom(
      buildBranchFetch({ ref: { ...ref('a'), owner: 'octo-org' }, defaultBranch: 'main' }),
    );
    expect(inner.headRef).not.toBe(outer.headRef);
    expect(lower.headRef).toBe(outer.headRef);
  });

  test.for([
    ['an unsafe branch', '-x', 'main'],
    ['an unsafe default branch', 'topic', 'a..b'],
  ] as const)('refuses %s', ([, branch, defaultBranch], { expect }) => {
    expect(buildBranchFetch({ ref: ref(branch), defaultBranch })).toMatchObject({ ok: false });
  });
});
