import { describe } from 'vitest';

import { listRangeCommits } from './list-range-commits.ts';
import { test } from './testing/test.ts';

describe('listRangeCommits', () => {
  test('lists commits oldest first with zero-context patches, subjects and patch-ids', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', '1\n2\n3\n');
    const base = await repo.commit('base');
    repo.write('a.txt', '1\ntwo\n3\n');
    const first = await repo.commit('diff --git looks like a header: 1:  abc = 2: def');
    const empty = await repo.commit('nothing');
    repo.write('b.txt', 'new\n');
    const second = await repo.commit('add b');

    const listed = await listRangeCommits(git, { base, head: second });
    expect(listed).toMatchObject({ ok: true, value: { truncated: false } });
    const commits = listed.ok ? listed.value.commits : [];
    expect(
      commits.map(({ sha, parent, subject }) => {
        return [sha, parent, subject];
      }),
    ).toStrictEqual([
      [first, base, 'diff --git looks like a header: 1:  abc = 2: def'],
      [empty, first, 'nothing'],
      [second, empty, 'add b'],
    ]);
    expect(commits[0]?.files[0]?.hunks).toMatchObject([
      { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 },
    ]);
    expect(commits[0]?.patchId).toMatch(objectIdPattern());
    expect(commits[1]).toMatchObject({ patchId: undefined, files: [] });
    expect(commits[2]?.files[0]).toMatchObject({ status: 'added', path: 'b.txt' });
  });

  test('keeps the newest commits when the range is too long', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const base = await repo.commit('base');
    await repo.commit('one');
    const two = await repo.commit('two');
    const three = await repo.commit('three');
    const listed = await listRangeCommits(git, { base, head: three }, { maxCommits: 2 });
    expect(listed.ok && listed.value.commits.map(({ sha }) => sha)).toStrictEqual([two, three]);
    expect(listed.ok && listed.value.truncated).toBe(true);
    await expect(listRangeCommits(git, { base: three, head: three })).resolves.toStrictEqual({
      ok: true,
      value: { commits: [], truncated: false },
    });
  });
});

function objectIdPattern(): RegExp {
  return /^[0-9a-f]{40}$/u;
}
