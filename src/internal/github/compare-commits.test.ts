import { describe } from 'vitest';

import { compareCommits } from './compare-commits.ts';
import { test } from './testing/test.ts';

function commit(sha: string, login: string | undefined): Record<string, unknown> {
  return {
    sha,
    commit: {
      message: `${sha} subject\n\nbody`,
      author: { name: 'Ada', date: '2026-10-01T00:00:00Z' },
    },
    author: accountOf(login),
  };
}

function accountOf(login: string | undefined): unknown {
  if (login === undefined) {
    // eslint-disable-next-line unicorn/no-null -- GitHub spells an unknown author as null.
    return null;
  }
  return { login };
}

describe('compareCommits', () => {
  test('sums the files and keeps the commits, oldest first', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: {
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
          total_commits: 2,
          commits: [commit('AAA', 'octocat'), commit('bbb', undefined)],
          files: [
            { filename: 'a.ts', additions: 3, deletions: 1 },
            { filename: 'b.ts', additions: 4, deletions: 0 },
          ],
        },
      };
    });
    const result = await compareCommits(
      client,
      { owner: 'o', repo: 'r', base: 'main', head: 'bbb' },
      { signal },
    );
    expect(requests[0]?.url).toBe('https://api.github.com/repos/o/r/compare/main...bbb');
    expect(result).toStrictEqual({
      ok: true,
      value: {
        status: 'ahead',
        aheadBy: 2,
        behindBy: 0,
        size: { additions: 7, deletions: 1, changedFiles: 2 },
        commits: [
          {
            sha: 'aaa',
            message: 'AAA subject\n\nbody',
            author: 'octocat',
            date: '2026-10-01T00:00:00Z',
          },
          {
            sha: 'bbb',
            message: 'bbb subject\n\nbody',
            author: 'Ada',
            date: '2026-10-01T00:00:00Z',
          },
        ],
        isTruncated: false,
      },
    });
  });

  test('says when GitHub listed fewer commits than there are', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 200,
        body: { status: 'identical', ahead_by: 0, behind_by: 0, total_commits: 300, commits: [] },
      };
    });
    await expect(
      compareCommits(client, { owner: 'o', repo: 'r', base: 'main', head: 'x' }, { signal }),
    ).resolves.toMatchObject({
      ok: true,
      value: { aheadBy: 0, size: { changedFiles: 0 }, isTruncated: true },
    });
  });
});
