import { describe } from 'vitest';

import { parseWorktreeList } from './parse-worktree-list.ts';
import { test } from './testing/test.ts';

describe('parseWorktreeList', () => {
  test('parses main, detached, locked and prunable worktrees', ({ expect }) => {
    const output = [
      '/repo',
      `HEAD ${sha()}`,
      'branch refs/heads/main',
      '',
      '/wt/review one',
      `HEAD ${sha()}`,
      'detached',
      'locked',
      '',
      '/wt/gone',
      `HEAD ${sha()}`,
      'detached',
      'locked reason with\nnewline',
      'prunable gitdir file points to non-existent location',
      '',
      '',
    ]
      .map((field, index) => (index === 0 || field.startsWith('/') ? `worktree ${field}` : field))
      .join('\0');
    expect(parseWorktreeList(output)).toStrictEqual([
      {
        path: '/repo',
        head: sha(),
        checkout: { kind: 'branch', ref: 'refs/heads/main' },
        locked: undefined,
        prunable: undefined,
      },
      {
        path: '/wt/review one',
        head: sha(),
        checkout: { kind: 'detached' },
        locked: { reason: '' },
        prunable: undefined,
      },
      {
        path: '/wt/gone',
        head: sha(),
        checkout: { kind: 'detached' },
        locked: { reason: 'reason with\nnewline' },
        prunable: { reason: 'gitdir file points to non-existent location' },
      },
    ]);
  });

  test('handles bare repositories, unborn branches and a missing final terminator', ({
    expect,
  }) => {
    const output = [
      'worktree /bare.git',
      'bare',
      '',
      'worktree /new',
      `HEAD ${'0'.repeat(40)}`,
      'branch refs/heads/x',
    ].join('\0');
    expect(parseWorktreeList(output)).toMatchObject([
      { path: '/bare.git', head: undefined, checkout: { kind: 'bare' } },
      { path: '/new', head: undefined, checkout: { kind: 'branch', ref: 'refs/heads/x' } },
    ]);
  });

  test('rejects records without a worktree path', ({ expect }) => {
    expect(parseWorktreeList(`HEAD ${sha()}\0detached\0\0`)).toBeUndefined();
    expect(parseWorktreeList('')).toStrictEqual([]);
  });
});

function sha(): string {
  return 'bf80669e332dc67a7c7f708cc431bcca4b28479c';
}
