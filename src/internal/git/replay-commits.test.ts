import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { replayCommits } from './replay-commits.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

describe('replayCommits', () => {
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

  it('replays commits one by one onto another commit, without moving any ref', async () => {
    repo.write('a.txt', '1\n2\n3\n4\n5\n6\n7\n8\n9\n');
    const base = repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    repo.write('a.txt', '1\none\n3\n4\n5\n6\n7\n8\n9\n');
    const first = repo.commit('first');
    repo.write('a.txt', '1\none\n3\n4\n5\n6\n7\neight\n9\n');
    const second = repo.commit('second');
    repo.git('switch', '--quiet', 'main');
    repo.write('a.txt', '1\n2\n3\n4\nfive\n6\n7\n8\n9\n');
    const onto = repo.commit('upstream');
    const refs = repo.git('for-each-ref');

    const replayed = await replayCommits(git, onto, [
      { parent: base, commit: first },
      { parent: first, commit: second },
    ]);
    expect(replayed).toMatchObject({ ok: true, value: { kind: 'clean' } });
    const tree = replayed.ok && replayed.value.kind === 'clean' ? replayed.value.tree : '';
    expect(repo.git('show', `${tree}:a.txt`)).toBe('1\none\n3\n4\nfive\n6\n7\neight\n9');
    expect(repo.git('for-each-ref')).toBe(refs);

    await expect(replayCommits(git, onto, [])).resolves.toEqual({
      ok: true,
      value: { kind: 'clean', tree: repo.git('rev-parse', onto + '^{tree}') },
    });
  });

  it('stops at the first conflicting commit', async () => {
    repo.write('a.txt', 'x\n');
    const base = repo.commit('base');
    repo.write('a.txt', 'mine\n');
    const mine = repo.commit('mine');
    repo.git('switch', '--quiet', '--create', 'other', base);
    repo.write('a.txt', 'theirs\n');
    const theirs = repo.commit('theirs');

    await expect(
      replayCommits(git, theirs, [{ parent: base, commit: mine }]),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'conflicted', paths: ['a.txt'] } });
  });
});
