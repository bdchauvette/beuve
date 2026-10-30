import type { CommitSha } from '../object-id.ts';
import { setLine } from './set-line.ts';
import type { TestRepository } from './test-repository.ts';

/**
 * Three stacked pull requests on `main`, each editing its own file so stack operations stay clean:
 *
 * - `main`: `a.txt`, `b.txt`, `c.txt`, `d.txt` with lines `1`…`30`.
 * - `pr1` (base `main`): "pr1: a5" and "pr1: a15" edit `a.txt`.
 * - `pr2` (base `pr1`): "pr2: b5" and "pr2: b20" edit `b.txt`.
 * - `pr3` (base `pr2`): "pr3: c10" edits `c.txt`.
 *
 * Leaves `pr3` checked out.
 */
export interface PullRequestStack {
  readonly root: CommitSha;
  readonly pr1: readonly CommitSha[];
  readonly pr2: readonly CommitSha[];
  readonly pr3: readonly CommitSha[];
  /** Rewrites line `line` (1-based) of `file` in the worktree. */
  readonly setLine: (file: string, line: number, content: string) => void;
  /** `setLine` then commit, returning the commit. */
  readonly commitLine: (
    file: string,
    line: number,
    content: string,
    message: string,
  ) => Promise<CommitSha>;
}

export async function buildPullRequestStack(repo: TestRepository): Promise<PullRequestStack> {
  const commitLine = async (
    file: string,
    line: number,
    content: string,
    message: string,
  ): Promise<CommitSha> => {
    setLine(repo, file, line, content);
    return repo.commit(message);
  };

  const numbered = `${Array.from({ length: 30 }, (_, index) => String(index + 1)).join('\n')}\n`;
  for (const file of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
    repo.write(file, numbered);
  }
  const root = await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'pr1');
  const pr1 = [
    await commitLine('a.txt', 5, 'pr1-a5', 'pr1: a5'),
    await commitLine('a.txt', 15, 'pr1-a15', 'pr1: a15'),
  ];
  await repo.git('switch', '--quiet', '--create', 'pr2');
  const pr2 = [
    await commitLine('b.txt', 5, 'pr2-b5', 'pr2: b5'),
    await commitLine('b.txt', 20, 'pr2-b20', 'pr2: b20'),
  ];
  await repo.git('switch', '--quiet', '--create', 'pr3');
  const pr3 = [await commitLine('c.txt', 10, 'pr3-c10', 'pr3: c10')];
  return {
    root,
    pr1,
    pr2,
    pr3,
    setLine: (file, line, content): void => {
      setLine(repo, file, line, content);
    },
    commitLine,
  };
}
