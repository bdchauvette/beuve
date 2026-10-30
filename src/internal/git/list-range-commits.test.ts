import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listRangeCommits } from './list-range-commits.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

const objectIdPattern = /^[0-9a-f]{40}$/u;

describe('listRangeCommits', () => {
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

  it('lists commits oldest first with zero-context patches, subjects and patch-ids', async () => {
    repo.write('a.txt', '1\n2\n3\n');
    const base = repo.commit('base');
    repo.write('a.txt', '1\ntwo\n3\n');
    const first = repo.commit('diff --git looks like a header: 1:  abc = 2: def');
    const empty = repo.commit('nothing');
    repo.write('b.txt', 'new\n');
    const second = repo.commit('add b');

    const listed = await listRangeCommits(git, { base, head: second });
    expect(listed).toMatchObject({ ok: true, value: { truncated: false } });
    const commits = listed.ok ? listed.value.commits : [];
    expect(commits.map(({ sha, parent, subject }) => [sha, parent, subject])).toEqual([
      [first, base, 'diff --git looks like a header: 1:  abc = 2: def'],
      [empty, first, 'nothing'],
      [second, empty, 'add b'],
    ]);
    expect(commits[0]?.files[0]?.hunks).toMatchObject([
      { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 },
    ]);
    expect(commits[0]?.patchId).toMatch(objectIdPattern);
    expect(commits[1]).toMatchObject({ patchId: undefined, files: [] });
    expect(commits[2]?.files[0]).toMatchObject({ status: 'added', path: 'b.txt' });
  });

  it('keeps the newest commits when the range is too long', async () => {
    const base = repo.commit('base');
    repo.commit('one');
    const two = repo.commit('two');
    const three = repo.commit('three');
    const listed = await listRangeCommits(git, { base, head: three }, { maxCommits: 2 });
    expect(listed.ok && listed.value.commits.map(({ sha }) => sha)).toEqual([two, three]);
    expect(listed.ok && listed.value.truncated).toBe(true);
    await expect(listRangeCommits(git, { base: three, head: three })).resolves.toEqual({
      ok: true,
      value: { commits: [], truncated: false },
    });
  });
});
