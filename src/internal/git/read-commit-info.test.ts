import { describe } from 'vitest';

import { readCommitInfo } from './read-commit-info.ts';
import type { CommitSha } from './object-id.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

describe('readCommitInfo', () => {
  test('reads a commit’s parents, people, subject and body from its object', async ({
    expect,
    repo,
    repository: git,
    signal,
  }) => {
    repo.write('a.txt', 'a\n');
    const parent = await repo.commit('first');
    repo.write('a.txt', 'b\n');
    const commit = await repo.commit(
      'Tidy the order totals\n\n\nSkip blank lines.\nKeep the rest.\n',
    );
    const shown = await repo.git('show', '--no-patch', '--format=%an%x00%ae%x00%at', commit);
    const [name, email, seconds] = shown.split('\0', 3);

    const read = await readCommitInfo(git, commit, { signal });

    expect(read).toMatchObject({
      ok: true,
      value: {
        sha: commit,
        parents: [parent],
        author: { name, email },
        subject: 'Tidy the order totals',
        body: 'Skip blank lines.\nKeep the rest.',
      },
    });
    expect(okValueFrom(read)?.author.at).toStrictEqual(
      Temporal.Instant.fromEpochMilliseconds(0).add({ seconds: Number(seconds) }),
    );
  });

  test('has no body for a one-line message, and no parents for a root commit', async ({
    expect,
    repo,
    repository: git,
    signal,
  }) => {
    repo.write('a.txt', 'a\n');
    const root = await repo.commit('only a subject');

    await expect(readCommitInfo(git, root, { signal })).resolves.toMatchObject({
      ok: true,
      value: { parents: [], subject: 'only a subject', body: '' },
    });
  });

  test('answers nothing for a tree or a missing object', async ({
    expect,
    repo,
    repository: git,
    signal,
  }) => {
    repo.write('a.txt', 'a\n');
    const commit = await repo.commit('first');
    const tree = (await repo.git('show', '--no-patch', '--format=%T', commit)) as CommitSha;

    await expect(readCommitInfo(git, tree, { signal })).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      readCommitInfo(git, 'f'.repeat(40) as CommitSha, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
  });
});
