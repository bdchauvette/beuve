import { describe } from 'vitest';

import { computeCommitPairs } from './compute-commit-pairs.ts';
import type { CommitPair, CommitPairs } from './compute-commit-pairs.ts';
import { computeInterdiff } from './compute-interdiff.ts';
import type { Interdiff } from './compute-interdiff.ts';
import type { DiffFile, DiffLine } from './diff-model.ts';
import { diffObjects } from './diff-objects.ts';
import { findStackForkPoint } from './find-stack-fork-point.ts';
import type { StackForkPoint } from './find-stack-fork-point.ts';
import { listRangeCommits } from './list-range-commits.ts';
import type { CommitSha } from './object-id.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import type { ReviewRange } from './review-range.ts';
import { pullRequestStackTemplate } from './testing/pull-request-stack-template.ts';
import type { PullRequestStackCommits } from './testing/pull-request-stack-template.ts';
import { setLine } from './testing/set-line.ts';
import type { LineEdit } from './testing/set-line.ts';
import type { TestRepository } from './testing/test-repository.ts';
import type { TestRepositories } from './testing/test.ts';
import { test } from './testing/test.ts';

import type { Result } from '#x/result/result.ts';

/** End-to-end stack scenarios: fork point, commit pairs and interdiff composed as main does. */
describe('findStackForkPoint (stacked pull requests)', () => {
  test('hides a parent that gained a commit once the child is rebased onto it', async ({
    expect,
    repositories,
  }) => {
    const { repo, sha, commitLine, reviewedPr2, review } = await stackScenario(repositories);
    await repo.git('switch', '--quiet', 'pr1');
    const parentTip = await commitLine({ file: 'a.txt', line: 25, content: 'pr1-a25' }, 'pr1: a25');
    await repo.git('switch', '--quiet', 'pr2');
    await repo.git('rebase', '--quiet', 'pr1');

    const result = await review(reviewedPr2(), { base: parentTip, head: await sha('pr2') });
    expect(result.fork).toMatchObject({ forkPoint: parentTip, reason: 'merge-base' });
    expect(result.interdiff).toMatchObject({ kind: 'rebased', replay: 'range', files: [] });
    expect(result.kinds).toStrictEqual(['unchanged', 'unchanged']);
  });

  test('shows only the amendment, paired to its commit, when the child is reworked on rebase', async ({
    expect,
    repositories,
  }) => {
    const { repo, stack, sha, setLine, commitLine, reviewedPr2, review } =
      await stackScenario(repositories);
    await repo.git('switch', '--quiet', 'pr1');
    const parentTip = await commitLine({ file: 'a.txt', line: 25, content: 'pr1-a25' }, 'pr1: a25');
    await repo.git('switch', '--quiet', 'pr2');
    await repo.git('rebase', '--quiet', 'pr1');
    setLine({ file: 'b.txt', line: 20, content: 'pr2-b20-v2' });
    await repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');

    const result = await review(reviewedPr2(), { base: parentTip, head: await sha('pr2') });
    expect(result.files).toStrictEqual([['b.txt', ['-pr2-b20', '+pr2-b20-v2']]]);
    expect(result.kinds).toStrictEqual(['unchanged', 'modified']);
    const modified = result.pairs.pairs[1];
    expect(modified).toMatchObject({ kind: 'modified', previous: { sha: at(stack.pr2, 1) } });
    expect(summary(cleanInterdiffFiles(modified))).toStrictEqual([
      ['b.txt', ['-pr2-b20', '+pr2-b20-v2']],
    ]);
  });

  test('keeps a force-pushed parent out of a child that was not rebased yet', async ({
    expect,
    repositories,
  }) => {
    const { repo, git, stack, sha, setLine, commitLine, reviewedPr2, review } =
      await stackScenario(repositories);
    await repo.git('switch', '--quiet', 'pr1');
    setLine({ file: 'a.txt', line: 15, content: 'pr1-a15-v2' });
    await repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
    const parentTip = await sha('pr1');

    const unaware = value(
      await findStackForkPoint(git, { base: parentTip, head: at(stack.pr2, 1) }),
    );
    expect(unaware).toMatchObject({ forkPoint: at(stack.pr1, 0), reason: 'merge-base' });
    const unawareFiles = value(
      await diffObjects(git, { from: unaware.forkPoint, to: at(stack.pr2, 1) }),
    );
    expect(summary(unawareFiles).map(([path]) => path)).toStrictEqual(['a.txt', 'b.txt']);

    await repo.git('switch', '--quiet', 'pr2');
    const fixup = await commitLine({ file: 'b.txt', line: 25, content: 'pr2-b25' }, 'pr2: b25');
    const stale = await review(reviewedPr2(), { base: parentTip, head: fixup });
    expect(stale.fork).toStrictEqual({
      forkPoint: at(stack.pr1, 1),
      mergeBase: at(stack.pr1, 0),
      reason: 'reviewed-base',
      skipped: 1,
    });
    expect(stale.interdiff.kind).toBe('exact');
    expect(stale.files).toStrictEqual([['b.txt', ['-25', '+pr2-b25']]]);
    expect(stale.kinds).toStrictEqual(['unchanged', 'unchanged', 'added']);

    await repo.git('rebase', '--quiet', '--onto', 'pr1', at(stack.pr1, 1), 'pr2');
    const restacked = await review(reviewedPr2(), { base: parentTip, head: await sha('pr2') });
    expect(restacked.fork).toMatchObject({ forkPoint: parentTip, reason: 'merge-base' });
    expect(restacked.interdiff).toMatchObject({ kind: 'rebased', replay: 'range' });
    expect(restacked.files).toStrictEqual([['b.txt', ['-25', '+pr2-b25']]]);
  });

  test('starts after a squash-merged parent once the child is retargeted to main', async ({
    expect,
    repositories,
  }) => {
    const { repo, git, stack, sha, commitLine, reviewedPr2, squashMergePr1, review } =
      await stackScenario(repositories);
    const mainTip = await squashMergePr1();

    const full = value(await findStackForkPoint(git, { base: mainTip, head: at(stack.pr2, 1) }));
    expect(full).toStrictEqual({
      forkPoint: at(stack.pr1, 1),
      mergeBase: stack.root,
      reason: 'already-upstream',
      skipped: 2,
    });
    const fullFiles = value(await diffObjects(git, { from: full.forkPoint, to: at(stack.pr2, 1) }));
    expect(summary(fullFiles)).toStrictEqual([['b.txt', ['-5', '+pr2-b5', '-20', '+pr2-b20']]]);

    await repo.git('switch', '--quiet', 'pr2');
    const fixup = await commitLine({ file: 'b.txt', line: 25, content: 'pr2-b25' }, 'pr2: b25');
    const retargeted = await review(reviewedPr2(), { base: mainTip, head: fixup });
    expect(retargeted.fork.forkPoint).toBe(at(stack.pr1, 1));
    expect(retargeted.interdiff.kind).toBe('exact');
    expect(retargeted.files).toStrictEqual([['b.txt', ['-25', '+pr2-b25']]]);

    await repo.git('rebase', '--quiet', '--onto', 'main', at(stack.pr1, 1), 'pr2');
    const rebased = await review(reviewedPr2(), { base: mainTip, head: await sha('pr2') });
    expect(rebased.fork).toMatchObject({ forkPoint: mainTip, reason: 'merge-base' });
    expect(rebased.interdiff).toMatchObject({ kind: 'rebased', replay: 'range' });
    expect(rebased.files).toStrictEqual([['b.txt', ['-25', '+pr2-b25']]]);
    expect(rebased.kinds).toStrictEqual(['unchanged', 'unchanged', 'added']);
  });

  test('recognizes a rebase-merged parent by patch-id, and git rebase drops it the same way', async ({
    expect,
    repositories,
  }) => {
    const { repo, git, stack, sha, commitLine, reviewedPr2, review } =
      await stackScenario(repositories);
    await repo.git('switch', '--quiet', 'main');
    const unrelated = await commitLine({ file: 'd.txt', line: 3, content: 'main-d3' }, 'main: d3');
    await repo.git('cherry-pick', at(stack.pr1, 0), at(stack.pr1, 1));
    const mainTip = await sha('main');
    const parentOnMain = value(await listRangeCommits(git, { base: unrelated, head: mainTip }));
    const parentOnBranch = value(
      await listRangeCommits(git, { base: stack.root, head: at(stack.pr1, 1) }),
    );
    expect(parentOnMain.commits.map((commit) => commit.sha)).not.toStrictEqual(stack.pr1);
    expect(parentOnMain.commits.map((commit) => commit.patchId)).toStrictEqual(
      parentOnBranch.commits.map((commit) => commit.patchId),
    );

    const retargeted = value(
      await findStackForkPoint(git, { base: mainTip, head: at(stack.pr2, 1) }),
    );
    expect(retargeted).toMatchObject({ forkPoint: at(stack.pr1, 1), reason: 'already-upstream' });

    await repo.git('switch', '--quiet', 'pr2');
    await repo.git('rebase', '--quiet', 'main');
    const result = await review(reviewedPr2(), { base: mainTip, head: await sha('pr2') });
    expect(result.fork.forkPoint).toBe(mainTip);
    expect(result.interdiff).toMatchObject({ kind: 'rebased', files: [] });
    expect(result.kinds).toStrictEqual(['unchanged', 'unchanged']);
  });

  test('restacks a three-PR stack after the bottom is squash-merged without showing anything new', async ({
    expect,
    repositories,
  }) => {
    const { repo, git, stack, sha, reviewedPr2, squashMergePr1, review } =
      await stackScenario(repositories);
    const reviewedPr3 = { base: at(stack.pr2, 1), head: at(stack.pr3, 0) };
    const mainTip = await squashMergePr1();
    await repo.git('rebase', '--quiet', '--onto', 'main', at(stack.pr1, 1), 'pr2');
    const pr2Tip = await sha('pr2');

    const pr3Stale = value(
      await findStackForkPoint(
        git,
        { base: pr2Tip, head: at(stack.pr3, 0) },
        { reviewedBases: [reviewedPr3.base] },
      ),
    );
    expect(pr3Stale.forkPoint).toBe(at(stack.pr2, 1));
    const staleFiles = value(
      await diffObjects(git, { from: pr3Stale.forkPoint, to: at(stack.pr3, 0) }),
    );
    expect(summary(staleFiles)).toStrictEqual([['c.txt', ['-10', '+pr3-c10']]]);

    await repo.git('rebase', '--quiet', '--onto', 'pr2', at(stack.pr2, 1), 'pr3');
    const pr2 = await review(reviewedPr2(), { base: mainTip, head: pr2Tip });
    expect(pr2.interdiff).toMatchObject({ kind: 'rebased', files: [] });
    expect(pr2.kinds).toStrictEqual(['unchanged', 'unchanged']);
    const pr3 = await review(reviewedPr3, { base: pr2Tip, head: await sha('pr3') });
    expect(pr3.fork).toMatchObject({ forkPoint: pr2Tip, reason: 'merge-base' });
    expect(pr3.interdiff).toMatchObject({ kind: 'rebased', files: [] });
    expect(pr3.kinds).toStrictEqual(['unchanged']);
  });

  test('replays commit pairs when a commit moved into the parent makes the range replay conflict', async ({
    expect,
    repositories,
  }) => {
    const { repo, git, stack, sha, commitLine, reviewedPr2, review } =
      await stackScenario(repositories);
    await repo.git('switch', '--quiet', 'pr1');
    const parentTip = await commitLine(
      { file: 'b.txt', line: 5, content: 'moved-b5' },
      'pr1: b5 (moved from pr2)',
    );
    await repo.git('switch', '--quiet', '--force-create', 'pr2', 'pr1');
    await repo.git('cherry-pick', at(stack.pr2, 1));
    const head = await sha('pr2');

    const result = await review(reviewedPr2(), { base: parentTip, head: head });
    expect(result.kinds).toStrictEqual(['dropped', 'unchanged']);
    expect(result.interdiff).toMatchObject({ kind: 'rebased', replay: 'commit-pairs', files: [] });

    const rangeOnly = value(
      await computeInterdiff(git, { previous: reviewedPr2(), next: { base: parentTip, head } }),
    );
    expect(rangeOnly).toMatchObject({
      kind: 'fallback',
      reason: { kind: 'conflicts', paths: ['b.txt'] },
    });
  });

  test('falls back when the paired replay conflicts too', async ({ expect, repositories }) => {
    const { repo, sha, commitLine, reviewedPr2, review } = await stackScenario(repositories);
    await repo.git('switch', '--quiet', 'pr1');
    const parentTip = await commitLine(
      { file: 'b.txt', line: 20, content: 'parent-b20' },
      'pr1: b20',
    );
    await repo.git('switch', '--quiet', 'pr2');
    await repo.git('rebase', '--quiet', '--strategy-option=theirs', 'pr1');

    const result = await review(reviewedPr2(), { base: parentTip, head: await sha('pr2') });
    expect(result.interdiff).toMatchObject({
      kind: 'fallback',
      reason: { kind: 'conflicts', paths: ['b.txt'] },
    });
    expect(result.kinds).toStrictEqual(['unchanged', 'modified']);
    expect(result.pairs.pairs[1]).toMatchObject({
      interdiff: { kind: 'conflicts', paths: ['b.txt'] },
    });
  });
});

interface StackScenario {
  readonly repo: TestRepository;
  readonly git: GitRepository;
  readonly stack: PullRequestStackCommits;
  readonly sha: (revision: string) => Promise<CommitSha>;
  readonly setLine: (edit: LineEdit) => void;
  readonly commitLine: (edit: LineEdit, message: string) => Promise<CommitSha>;
  readonly reviewedPr2: () => ReviewRange;
  readonly squashMergePr1: () => Promise<CommitSha>;
  /** Reviews `next` (the base tip and head) after `previous`. */
  readonly review: (previous: ReviewRange, next: ReviewRange) => Promise<StackReview>;
}

/** What one review of the stack found: its fork point, pairs and interdiff. */
interface StackReview {
  readonly fork: StackForkPoint;
  readonly pairs: CommitPairs;
  readonly interdiff: Interdiff;
  readonly kinds: string[];
  readonly files: [string, string[]][];
}

/** A copy of the three-PR stack, and the steps the scenarios share. */
async function stackScenario(repositories: TestRepositories): Promise<StackScenario> {
  const { repo, value: stack } = await repositories.fromTemplate(pullRequestStackTemplate);
  const git = value(await openRepository(repo.directory));
  const setLineHere = (edit: LineEdit): void => {
    setLine(repo, edit);
  };
  const commitLine = async (edit: LineEdit, message: string): Promise<CommitSha> => {
    setLine(repo, edit);
    return await repo.commit(message);
  };
  const sha = async (revision: string): Promise<CommitSha> => {
    return (await repo.git('rev-parse', revision)) as CommitSha;
  };
  const reviewedPr2 = (): ReviewRange => {
    return { base: at(stack.pr1, 1), head: at(stack.pr2, 1) };
  };

  /** Squash-merges pr1 into main, adds an unrelated main commit, and returns main's tip. */
  const squashMergePr1 = async (): Promise<CommitSha> => {
    await repo.git('switch', '--quiet', 'main');
    await repo.git('merge', '--quiet', '--squash', 'pr1');
    await repo.commit('pr1 (#1)');
    return await commitLine({ file: 'd.txt', line: 3, content: 'main-d3' }, 'main: d3');
  };

  const review = async (previous: ReviewRange, next: ReviewRange): Promise<StackReview> => {
    const fork = value(await findStackForkPoint(git, next, { reviewedBases: [previous.base] }));
    const forked = { base: fork.forkPoint, head: next.head };
    const pairs = value(await computeCommitPairs(git, { previous, next: forked }));
    const interdiff = value(
      await computeInterdiff(
        git,
        { previous, next: forked },
        {
          pairedCommits: pairs.pairs
            .filter((pair) => pair.kind === 'unchanged' || pair.kind === 'modified')
            .map((pair) => {
              return { parent: pair.previous.parent, commit: pair.previous.sha };
            }),
        },
      ),
    );
    return {
      fork,
      pairs,
      interdiff,
      kinds: pairs.pairs.map((pair) => pair.kind),
      files: summary(interdiff.files),
    };
  };
  return {
    repo,
    git,
    stack,
    sha,
    setLine: setLineHere,
    commitLine,
    reviewedPr2,
    squashMergePr1,
    review,
  };
}

function at(commits: readonly CommitSha[], index: number): CommitSha {
  const commit = commits[index];
  if (commit === undefined) {
    throw new Error(`no commit ${String(index)}`);
  }
  return commit;
}

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
}

/** The files of a modified pair's clean per-pair interdiff; throws for anything else. */
function cleanInterdiffFiles(pair: CommitPair | undefined): readonly DiffFile[] {
  if (pair?.kind !== 'modified' || pair.interdiff.kind !== 'clean') {
    throw new Error(`expected a modified pair with a clean interdiff, got ${pair?.kind ?? 'none'}`);
  }
  return pair.interdiff.files;
}

function summary(files: readonly DiffFile[]): [string, string[]][] {
  return files.map((file) => {
    return [
      pathOf(file),
      file.hunks.flatMap((hunk) => {
        return hunk.lines
          .filter((line) => line.kind !== 'context')
          .map((line) => {
            return `${signOf(line)}${line.content}`;
          });
      }),
    ];
  });
}

function pathOf(file: DiffFile): string {
  if ('path' in file) {
    return file.path;
  }
  return file.newPath;
}

function signOf(line: DiffLine): string {
  if (line.kind === 'added') {
    return '+';
  }
  return '-';
}
