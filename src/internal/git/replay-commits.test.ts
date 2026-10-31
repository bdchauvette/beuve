import { describe } from 'vitest';

import { replayCommits } from './replay-commits.ts';
import { test } from './testing/test.ts';

describe('replayCommits', () => {
  test('replays commits one by one onto another commit, without moving any ref', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', '1\n2\n3\n4\n5\n6\n7\n8\n9\n');
    const base = await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'topic');
    repo.write('a.txt', '1\none\n3\n4\n5\n6\n7\n8\n9\n');
    const first = await repo.commit('first');
    repo.write('a.txt', '1\none\n3\n4\n5\n6\n7\neight\n9\n');
    const second = await repo.commit('second');
    await repo.git('switch', '--quiet', 'main');
    repo.write('a.txt', '1\n2\n3\n4\nfive\n6\n7\n8\n9\n');
    const onto = await repo.commit('upstream');
    const refs = await repo.git('for-each-ref');

    const replayed = await replayCommits(git, onto, [
      { parent: base, commit: first },
      { parent: first, commit: second },
    ]);
    expect(replayed).toMatchObject({ ok: true, value: { kind: 'clean' } });
    const tree = cleanTreeOf(replayed);
    await expect(repo.git('show', `${tree}:a.txt`)).resolves.toBe(
      '1\none\n3\n4\nfive\n6\n7\neight\n9',
    );
    await expect(repo.git('for-each-ref')).resolves.toBe(refs);

    await expect(replayCommits(git, onto, [])).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'clean', tree: await repo.git('rev-parse', onto + '^{tree}') },
    });
  });

  test('stops at the first conflicting commit', async ({ expect, repo, repository: git }) => {
    repo.write('a.txt', 'x\n');
    const base = await repo.commit('base');
    repo.write('a.txt', 'mine\n');
    const mine = await repo.commit('mine');
    await repo.git('switch', '--quiet', '--create', 'other', base);
    repo.write('a.txt', 'theirs\n');
    const theirs = await repo.commit('theirs');

    await expect(
      replayCommits(git, theirs, [{ parent: base, commit: mine }]),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'conflicted', paths: ['a.txt'] } });
  });
});

function cleanTreeOf(result: Awaited<ReturnType<typeof replayCommits>>): string {
  if (!result.ok || result.value.kind !== 'clean') {
    throw new Error('expected a clean replay');
  }
  return result.value.tree;
}
