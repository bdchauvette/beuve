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
    const { from, to } = await fork(repo);
    repo.write('b.txt', 'upstream\n');
    const onto = await repo.commit('upstream');
    const result = await replayChanges(git, { from, to, onto });
    expect(result).toMatchObject({ ok: true, value: { kind: 'clean' } });
    const { tree } = cleanReplay(result);
    await expect(repo.git('ls-tree', '--name-only', tree)).resolves.toBe('a.txt\nb.txt');
    await expect(repo.git('show', `${tree}:a.txt`)).resolves.toBe('1\ntopic\n3');
    await expect(repo.git('rev-parse', 'HEAD')).resolves.toBe(onto);
    await expect(repo.git('status', '--porcelain')).resolves.toBe('');
  });

  test('reports conflicted paths', async ({ expect, repo, repository: git }) => {
    const { from, to } = await fork(repo);
    repo.write('a.txt', '1\nupstream\n3\n');
    const onto = await repo.commit('upstream');
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
    const { from, to } = await fork(repo);
    const onto = await repo.commit('upstream');
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
    const { to } = await fork(repo);
    const onto = await repo.commit('upstream');
    const old = { ...git, version: { major: 2, minor: 39, patch: 0, raw: '' } };
    await expect(replayChanges(old, { from: onto, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'unsupported', required: '2.40' },
    });
  });
});

async function fork(
  repo: TestRepository,
): Promise<{ readonly from: CommitSha; readonly to: CommitSha }> {
  repo.write('a.txt', '1\n2\n3\n');
  const from = await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'topic');
  repo.write('a.txt', '1\ntopic\n3\n');
  const to = await repo.commit('topic');
  await repo.git('switch', '--quiet', 'main');
  return { from, to };
}

function cleanReplay(result: Awaited<ReturnType<typeof replayChanges>>): { readonly tree: string } {
  if (!result.ok || result.value.kind !== 'clean') {
    throw new Error('expected a clean replay');
  }
  return result.value;
}
