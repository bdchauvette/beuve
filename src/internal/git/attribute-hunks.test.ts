import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { attributeHunks } from './attribute-hunks.ts';
import { diffObjects } from './diff-objects.ts';
import { listRangeCommits } from './list-range-commits.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { TestRepository } from './testing/test-repository.ts';
import { test } from './testing/test.ts';

describe('attributeHunks', () => {
  test('follows lines shifted by later commits and gives rewritten lines to the rewriter', async ({
    expect,
    repo,
    repository,
  }) => {
    const { edit, attribute } = appFile(repo, repository);
    const bottom = edit((lines) => lines.with(29, 'bottom edit'), 'edit the bottom');
    const top = edit((lines) => ['new 1', 'new 2', 'new 3', ...lines], 'insert at the top');
    const rewrite = edit((lines) => lines.with(32, 'bottom rewritten'), 'rewrite the bottom');
    const removal = edit((lines) => lines.toSpliced(15, 2), 'remove two lines');

    const [file] = await attribute(removal);
    expect(file?.commits).toStrictEqual([bottom, top, rewrite, removal]);
    expect(file?.hunks).toStrictEqual([[top], [removal], [rewrite]]);
  });

  test('attributes an interdiff hunk to the commit that produced its new lines', async ({
    expect,
    repo,
    repository,
  }) => {
    const { edit, attribute } = appFile(repo, repository);
    const first = edit((lines) => lines.with(4, 'first'), 'first');
    edit((lines) => lines.with(19, 'second'), 'second');
    const fixup = edit((lines) => lines.with(19, 'second, fixed'), 'fixup');

    const [file] = await attribute(fixup, first);
    expect(file?.hunks).toStrictEqual([[fixup]]);
  });

  test('follows a rename', async ({ expect, repo, repository }) => {
    const { base, edit } = appFile(repo, repository);
    const edited = edit((lines) => lines.with(9, 'edited'), 'edit');
    repo.git('mv', 'app.txt', 'main.txt');
    const renamed = repo.commit('rename');

    const files = okValueFrom(await diffObjects(repository, base, renamed));
    const { commits } = okValueFrom(await listRangeCommits(repository, { base, head: renamed }));
    const [file] = attributeHunks(files, commits);
    expect(file?.commits).toStrictEqual([edited, renamed]);
    expect(file?.hunks).toStrictEqual([[edited]]);
  });
});

interface AppFile {
  /** The commit adding `app.txt` with lines `line 1` … `line 40`. */
  readonly base: CommitSha;
  /** Rewrites `app.txt`'s lines with `change` and commits. */
  readonly edit: (change: (lines: string[]) => string[], message: string) => CommitSha;
  /** `attributeHunks` for `from..head` (context 1) over the commits `base..head`. */
  readonly attribute: (
    head: CommitSha,
    from?: CommitSha,
  ) => Promise<ReturnType<typeof attributeHunks>>;
}

function appFile(repo: TestRepository, git: GitRepository): AppFile {
  let content = Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)}`);
  repo.write('app.txt', text(content));
  const base = repo.commit('base');
  return {
    base,
    edit: (change, message): CommitSha => {
      content = change(content);
      repo.write('app.txt', text(content));
      return repo.commit(message);
    },
    attribute: async (head, from = base): Promise<ReturnType<typeof attributeHunks>> => {
      const { commits } = okValueFrom(await listRangeCommits(git, { base, head }));
      const files = okValueFrom(await diffObjects(git, from, head, { contextLines: 1 }));
      return attributeHunks(files, commits);
    },
  };
}

function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
