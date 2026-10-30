import { describe } from 'vitest';

import type { CommitSha } from './object-id.ts';
import { replayChanges } from './replay-changes.ts';
import type { TestRepository } from './testing/test-repository.ts';
import { test } from './testing/test.ts';

describe('replayChanges', () => {
  test('writes the replayed tree without touching refs or the worktree', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const { from, to } = fork(repo);
    repo.write('b.txt', 'upstream\n');
    const onto = repo.commit('upstream');
    const result = await replayChanges(git, { from, to, onto });
    expect(result).toMatchObject({ ok: true, value: { kind: 'clean' } });
    const { tree } = cleanReplay(result);
    expect(repo.git('ls-tree', '--name-only', tree)).toBe('a.txt\nb.txt');
    expect(repo.git('show', `${tree}:a.txt`)).toBe('1\ntopic\n3');
    expect(repo.git('rev-parse', 'HEAD')).toBe(onto);
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  test('reports conflicted paths', async ({ expect, repo, repository: git }) => {
    const { from, to } = fork(repo);
    repo.write('a.txt', '1\nupstream\n3\n');
    const onto = repo.commit('upstream');
    await expect(replayChanges(git, { from, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'conflicted', paths: ['a.txt'] },
    });
  });

  test('declines on git without merge-tree --write-tree', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const { from, to } = fork(repo);
    const onto = repo.commit('upstream');
    const old = { ...git, version: { major: 2, minor: 37, patch: 1, raw: '' } };
    await expect(replayChanges(old, { from, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'unsupported', required: '2.38' },
    });
  });

  test('declines on git 2.38–2.39 when the computed merge-base is not the requested base', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const { to } = fork(repo);
    const onto = repo.commit('upstream');
    const old = { ...git, version: { major: 2, minor: 39, patch: 0, raw: '' } };
    await expect(replayChanges(old, { from: onto, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'unsupported', required: '2.40' },
    });
  });
});

function fork(repo: TestRepository): { readonly from: CommitSha; readonly to: CommitSha } {
  repo.write('a.txt', '1\n2\n3\n');
  const from = repo.commit('base');
  repo.git('switch', '--quiet', '--create', 'topic');
  repo.write('a.txt', '1\ntopic\n3\n');
  const to = repo.commit('topic');
  repo.git('switch', '--quiet', 'main');
  return { from, to };
}

function cleanReplay(result: Awaited<ReturnType<typeof replayChanges>>): { readonly tree: string } {
  if (!result.ok || result.value.kind !== 'clean') {
    throw new Error('expected a clean replay');
  }
  return result.value;
}
