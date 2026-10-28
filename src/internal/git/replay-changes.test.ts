import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { replayChanges } from './replay-changes.ts';

describe('replayChanges', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  const fork = (): {
    from: ReturnType<TestRepository['commit']>;
    to: ReturnType<TestRepository['commit']>;
  } => {
    repo.write('a.txt', '1\n2\n3\n');
    const from = repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    repo.write('a.txt', '1\ntopic\n3\n');
    const to = repo.commit('topic');
    repo.git('switch', '--quiet', 'main');
    return { from, to };
  };

  it('writes the replayed tree without touching refs or the worktree', async () => {
    const { from, to } = fork();
    repo.write('b.txt', 'upstream\n');
    const onto = repo.commit('upstream');
    const result = await replayChanges(git, { from, to, onto });
    expect(result).toMatchObject({ ok: true, value: { kind: 'clean' } });
    if (result.ok && result.value.kind === 'clean') {
      expect(repo.git('ls-tree', '--name-only', result.value.tree)).toBe('a.txt\nb.txt');
      expect(repo.git('show', `${result.value.tree}:a.txt`)).toBe('1\ntopic\n3');
    }
    expect(repo.git('rev-parse', 'HEAD')).toBe(onto);
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('reports conflicted paths', async () => {
    const { from, to } = fork();
    repo.write('a.txt', '1\nupstream\n3\n');
    const onto = repo.commit('upstream');
    await expect(replayChanges(git, { from, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'conflicted', paths: ['a.txt'] },
    });
  });

  it('declines on git without merge-tree --write-tree', async () => {
    const { from, to } = fork();
    const onto = repo.commit('upstream');
    const old = { ...git, version: { major: 2, minor: 37, patch: 1, raw: '' } };
    await expect(replayChanges(old, { from, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'unsupported', required: '2.38' },
    });
  });

  it('declines on git 2.38–2.39 when the computed merge-base is not the requested base', async () => {
    const { to } = fork();
    const onto = repo.commit('upstream');
    const old = { ...git, version: { major: 2, minor: 39, patch: 0, raw: '' } };
    await expect(replayChanges(old, { from: onto, to, onto })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'unsupported', required: '2.40' },
    });
  });
});
