import { describe, expect, it } from 'vitest';

import { parseWorktreeList } from './parse-worktree-list.ts';

const sha = 'bf80669e332dc67a7c7f708cc431bcca4b28479c';

describe('parseWorktreeList', () => {
  it('parses main, detached, locked and prunable worktrees', () => {
    const output = [
      '/repo',
      `HEAD ${sha}`,
      'branch refs/heads/main',
      '',
      '/wt/review one',
      `HEAD ${sha}`,
      'detached',
      'locked',
      '',
      '/wt/gone',
      `HEAD ${sha}`,
      'detached',
      'locked reason with\nnewline',
      'prunable gitdir file points to non-existent location',
      '',
      '',
    ]
      .map((field, index) => (index === 0 || field.startsWith('/') ? `worktree ${field}` : field))
      .join('\0');
    expect(parseWorktreeList(output)).toEqual([
      {
        path: '/repo',
        head: sha,
        checkout: { kind: 'branch', ref: 'refs/heads/main' },
        locked: undefined,
        prunable: undefined,
      },
      {
        path: '/wt/review one',
        head: sha,
        checkout: { kind: 'detached' },
        locked: { reason: '' },
        prunable: undefined,
      },
      {
        path: '/wt/gone',
        head: sha,
        checkout: { kind: 'detached' },
        locked: { reason: 'reason with\nnewline' },
        prunable: { reason: 'gitdir file points to non-existent location' },
      },
    ]);
  });

  it('handles bare repositories, unborn branches and a missing final terminator', () => {
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

  it('rejects records without a worktree path', () => {
    expect(parseWorktreeList(`HEAD ${sha}\0detached\0\0`)).toBeUndefined();
    expect(parseWorktreeList('')).toEqual([]);
  });
});
