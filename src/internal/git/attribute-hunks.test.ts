import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attributeHunks } from './attribute-hunks.ts';
import { diffObjects } from './diff-objects.ts';
import { listRangeCommits } from './list-range-commits.ts';
import type { CommitSha } from './object-id.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

describe('attributeHunks', () => {
  let repo: TestRepository;
  let git: GitRepository;
  let base: CommitSha;
  let content: string[];
  beforeEach(async () => {
    repo = createTestRepository();
    content = Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)}`);
    repo.write('app.txt', text(content));
    base = repo.commit('base');
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  const edit = (change: (lines: string[]) => string[], message: string): CommitSha => {
    content = change(content);
    repo.write('app.txt', text(content));
    return repo.commit(message);
  };

  const attribute = async (
    head: CommitSha,
    from: CommitSha = base,
  ): Promise<ReturnType<typeof attributeHunks>> => {
    const commits = await listRangeCommits(git, { base, head });
    const files = await diffObjects(git, from, head, { contextLines: 1 });
    if (!commits.ok || !files.ok) {
      throw new Error('git failed');
    }
    return attributeHunks(files.value, commits.value.commits);
  };

  it('follows lines shifted by later commits and gives rewritten lines to the rewriter', async () => {
    const bottom = edit((lines) => lines.with(29, 'bottom edit'), 'edit the bottom');
    const top = edit((lines) => ['new 1', 'new 2', 'new 3', ...lines], 'insert at the top');
    const rewrite = edit((lines) => lines.with(32, 'bottom rewritten'), 'rewrite the bottom');
    const removal = edit((lines) => lines.toSpliced(15, 2), 'remove two lines');
    const head = removal;

    const [file] = await attribute(head);
    expect(file?.commits).toEqual([bottom, top, rewrite, removal]);
    expect(file?.hunks).toEqual([[top], [removal], [rewrite]]);
  });

  it('attributes an interdiff hunk to the commit that produced its new lines', async () => {
    const first = edit((lines) => lines.with(4, 'first'), 'first');
    edit((lines) => lines.with(19, 'second'), 'second');
    const fixup = edit((lines) => lines.with(19, 'second, fixed'), 'fixup');

    const [file] = await attribute(fixup, first);
    expect(file?.hunks).toEqual([[fixup]]);
  });

  it('follows a rename', async () => {
    const edited = edit((lines) => lines.with(9, 'edited'), 'edit');
    repo.git('mv', 'app.txt', 'main.txt');
    const renamed = repo.commit('rename');

    const files = await diffObjects(git, base, renamed);
    const commits = await listRangeCommits(git, { base, head: renamed });
    if (!files.ok || !commits.ok) {
      throw new Error('git failed');
    }
    const [file] = attributeHunks(files.value, commits.value.commits);
    expect(file?.commits).toEqual([edited, renamed]);
    expect(file?.hunks).toEqual([[edited]]);
  });
});

function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
