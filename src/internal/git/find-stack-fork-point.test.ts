import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeCommitPairs } from './compute-commit-pairs.ts';
import type { CommitPairs } from './compute-commit-pairs.ts';
import { computeInterdiff } from './compute-interdiff.ts';
import type { Interdiff } from './compute-interdiff.ts';
import type { DiffFile } from './diff-model.ts';
import { diffObjects } from './diff-objects.ts';
import { findStackForkPoint } from './find-stack-fork-point.ts';
import type { StackForkPoint } from './find-stack-fork-point.ts';
import { listRangeCommits } from './list-range-commits.ts';
import type { CommitSha } from './object-id.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import type { ReviewRange } from './review-range.ts';
import { buildPullRequestStack } from './testing/build-pull-request-stack.ts';
import type { PullRequestStack } from './testing/build-pull-request-stack.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

/** End-to-end stack scenarios: fork point, commit pairs and interdiff composed as main does. */
describe('findStackForkPoint (stacked pull requests)', () => {
  let repo: TestRepository;
  let git: GitRepository;
  let stack: PullRequestStack;
  beforeEach(async () => {
    repo = createTestRepository();
    stack = buildPullRequestStack(repo);
    git = value(await openRepository(repo.directory));
  });
  afterEach(() => {
    repo.cleanup();
  });

  const sha = (revision: string): CommitSha => repo.git('rev-parse', revision) as CommitSha;
  const reviewedPr2 = (): ReviewRange => ({ base: at(stack.pr1, 1), head: at(stack.pr2, 1) });

  /** Squash-merges pr1 into main, adds an unrelated main commit, and returns main's tip. */
  const squashMergePr1 = (): CommitSha => {
    repo.git('switch', '--quiet', 'main');
    repo.git('merge', '--quiet', '--squash', 'pr1');
    repo.commit('pr1 (#1)');
    return stack.commitLine('d.txt', 3, 'main-d3', 'main: d3');
  };

  const review = async (
    previous: ReviewRange,
    baseTip: CommitSha,
    head: CommitSha,
  ): Promise<{
    fork: StackForkPoint;
    pairs: CommitPairs;
    interdiff: Interdiff;
    kinds: string[];
    files: [string, string[]][];
  }> => {
    const fork = value(
      await findStackForkPoint(git, { base: baseTip, head }, { reviewedBases: [previous.base] }),
    );
    const next = { base: fork.forkPoint, head };
    const pairs = value(await computeCommitPairs(git, previous, next));
    const interdiff = value(
      await computeInterdiff(git, previous, next, {
        pairedCommits: pairs.pairs
          .filter((pair) => pair.kind === 'unchanged' || pair.kind === 'modified')
          .map((pair) => ({ parent: pair.previous.parent, commit: pair.previous.sha })),
      }),
    );
    return {
      fork,
      pairs,
      interdiff,
      kinds: pairs.pairs.map((pair) => pair.kind),
      files: summary(interdiff.files),
    };
  };

  it('hides a parent that gained a commit once the child is rebased onto it', async () => {
    repo.git('switch', '--quiet', 'pr1');
    const parentTip = stack.commitLine('a.txt', 25, 'pr1-a25', 'pr1: a25');
    repo.git('switch', '--quiet', 'pr2');
    repo.git('rebase', '--quiet', 'pr1');

    const result = await review(reviewedPr2(), parentTip, sha('pr2'));
    expect(result.fork).toMatchObject({ forkPoint: parentTip, reason: 'merge-base' });
    expect(result.interdiff).toMatchObject({ kind: 'rebased', replay: 'range', files: [] });
    expect(result.kinds).toEqual(['unchanged', 'unchanged']);
  });

  it('shows only the amendment, paired to its commit, when the child is reworked on rebase', async () => {
    repo.git('switch', '--quiet', 'pr1');
    const parentTip = stack.commitLine('a.txt', 25, 'pr1-a25', 'pr1: a25');
    repo.git('switch', '--quiet', 'pr2');
    repo.git('rebase', '--quiet', 'pr1');
    stack.setLine('b.txt', 20, 'pr2-b20-v2');
    repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');

    const result = await review(reviewedPr2(), parentTip, sha('pr2'));
    expect(result.files).toEqual([['b.txt', ['-pr2-b20', '+pr2-b20-v2']]]);
    expect(result.kinds).toEqual(['unchanged', 'modified']);
    const modified = result.pairs.pairs[1];
    expect(modified).toMatchObject({ kind: 'modified', previous: { sha: at(stack.pr2, 1) } });
    expect(
      modified?.kind === 'modified' && modified.interdiff.kind === 'clean'
        ? summary(modified.interdiff.files)
        : undefined,
    ).toEqual([['b.txt', ['-pr2-b20', '+pr2-b20-v2']]]);
  });

  it('keeps a force-pushed parent out of a child that was not rebased yet', async () => {
    repo.git('switch', '--quiet', 'pr1');
    stack.setLine('a.txt', 15, 'pr1-a15-v2');
    repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
    const parentTip = sha('pr1');

    const unaware = value(
      await findStackForkPoint(git, { base: parentTip, head: at(stack.pr2, 1) }),
    );
    expect(unaware).toMatchObject({ forkPoint: at(stack.pr1, 0), reason: 'merge-base' });
    const unawareFiles = value(await diffObjects(git, unaware.forkPoint, at(stack.pr2, 1)));
    expect(summary(unawareFiles).map(([path]) => path)).toEqual(['a.txt', 'b.txt']);

    repo.git('switch', '--quiet', 'pr2');
    const fixup = stack.commitLine('b.txt', 25, 'pr2-b25', 'pr2: b25');
    const stale = await review(reviewedPr2(), parentTip, fixup);
    expect(stale.fork).toEqual({
      forkPoint: at(stack.pr1, 1),
      mergeBase: at(stack.pr1, 0),
      reason: 'reviewed-base',
      skipped: 1,
    });
    expect(stale.interdiff.kind).toBe('exact');
    expect(stale.files).toEqual([['b.txt', ['-25', '+pr2-b25']]]);
    expect(stale.kinds).toEqual(['unchanged', 'unchanged', 'added']);

    repo.git('rebase', '--quiet', '--onto', 'pr1', at(stack.pr1, 1), 'pr2');
    const restacked = await review(reviewedPr2(), parentTip, sha('pr2'));
    expect(restacked.fork).toMatchObject({ forkPoint: parentTip, reason: 'merge-base' });
    expect(restacked.interdiff).toMatchObject({ kind: 'rebased', replay: 'range' });
    expect(restacked.files).toEqual([['b.txt', ['-25', '+pr2-b25']]]);
  });

  it('starts after a squash-merged parent once the child is retargeted to main', async () => {
    const mainTip = squashMergePr1();

    const full = value(await findStackForkPoint(git, { base: mainTip, head: at(stack.pr2, 1) }));
    expect(full).toEqual({
      forkPoint: at(stack.pr1, 1),
      mergeBase: stack.root,
      reason: 'already-upstream',
      skipped: 2,
    });
    const fullFiles = value(await diffObjects(git, full.forkPoint, at(stack.pr2, 1)));
    expect(summary(fullFiles)).toEqual([['b.txt', ['-5', '+pr2-b5', '-20', '+pr2-b20']]]);

    repo.git('switch', '--quiet', 'pr2');
    const fixup = stack.commitLine('b.txt', 25, 'pr2-b25', 'pr2: b25');
    const retargeted = await review(reviewedPr2(), mainTip, fixup);
    expect(retargeted.fork.forkPoint).toBe(at(stack.pr1, 1));
    expect(retargeted.interdiff.kind).toBe('exact');
    expect(retargeted.files).toEqual([['b.txt', ['-25', '+pr2-b25']]]);

    repo.git('rebase', '--quiet', '--onto', 'main', at(stack.pr1, 1), 'pr2');
    const rebased = await review(reviewedPr2(), mainTip, sha('pr2'));
    expect(rebased.fork).toMatchObject({ forkPoint: mainTip, reason: 'merge-base' });
    expect(rebased.interdiff).toMatchObject({ kind: 'rebased', replay: 'range' });
    expect(rebased.files).toEqual([['b.txt', ['-25', '+pr2-b25']]]);
    expect(rebased.kinds).toEqual(['unchanged', 'unchanged', 'added']);
  });

  it('recognizes a rebase-merged parent by patch-id, and git rebase drops it the same way', async () => {
    repo.git('switch', '--quiet', 'main');
    const unrelated = stack.commitLine('d.txt', 3, 'main-d3', 'main: d3');
    repo.git('cherry-pick', at(stack.pr1, 0), at(stack.pr1, 1));
    const mainTip = sha('main');
    const parentOnMain = value(await listRangeCommits(git, { base: unrelated, head: mainTip }));
    const parentOnBranch = value(
      await listRangeCommits(git, { base: stack.root, head: at(stack.pr1, 1) }),
    );
    expect(parentOnMain.commits.map((commit) => commit.sha)).not.toEqual(stack.pr1);
    expect(parentOnMain.commits.map((commit) => commit.patchId)).toEqual(
      parentOnBranch.commits.map((commit) => commit.patchId),
    );

    const retargeted = value(
      await findStackForkPoint(git, { base: mainTip, head: at(stack.pr2, 1) }),
    );
    expect(retargeted).toMatchObject({ forkPoint: at(stack.pr1, 1), reason: 'already-upstream' });

    repo.git('switch', '--quiet', 'pr2');
    repo.git('rebase', '--quiet', 'main');
    const result = await review(reviewedPr2(), mainTip, sha('pr2'));
    expect(result.fork.forkPoint).toBe(mainTip);
    expect(result.interdiff).toMatchObject({ kind: 'rebased', files: [] });
    expect(result.kinds).toEqual(['unchanged', 'unchanged']);
  });

  it('restacks a three-PR stack after the bottom is squash-merged without showing anything new', async () => {
    const reviewedPr3 = { base: at(stack.pr2, 1), head: at(stack.pr3, 0) };
    const mainTip = squashMergePr1();
    repo.git('rebase', '--quiet', '--onto', 'main', at(stack.pr1, 1), 'pr2');
    const pr2Tip = sha('pr2');

    const pr3Stale = value(
      await findStackForkPoint(
        git,
        { base: pr2Tip, head: at(stack.pr3, 0) },
        { reviewedBases: [reviewedPr3.base] },
      ),
    );
    expect(pr3Stale.forkPoint).toBe(at(stack.pr2, 1));
    const staleFiles = value(await diffObjects(git, pr3Stale.forkPoint, at(stack.pr3, 0)));
    expect(summary(staleFiles)).toEqual([['c.txt', ['-10', '+pr3-c10']]]);

    repo.git('rebase', '--quiet', '--onto', 'pr2', at(stack.pr2, 1), 'pr3');
    const pr2 = await review(reviewedPr2(), mainTip, pr2Tip);
    expect(pr2.interdiff).toMatchObject({ kind: 'rebased', files: [] });
    expect(pr2.kinds).toEqual(['unchanged', 'unchanged']);
    const pr3 = await review(reviewedPr3, pr2Tip, sha('pr3'));
    expect(pr3.fork).toMatchObject({ forkPoint: pr2Tip, reason: 'merge-base' });
    expect(pr3.interdiff).toMatchObject({ kind: 'rebased', files: [] });
    expect(pr3.kinds).toEqual(['unchanged']);
  });

  it('replays commit pairs when a commit moved into the parent makes the range replay conflict', async () => {
    repo.git('switch', '--quiet', 'pr1');
    const parentTip = stack.commitLine('b.txt', 5, 'moved-b5', 'pr1: b5 (moved from pr2)');
    repo.git('switch', '--quiet', '--force-create', 'pr2', 'pr1');
    repo.git('cherry-pick', at(stack.pr2, 1));
    const head = sha('pr2');

    const result = await review(reviewedPr2(), parentTip, head);
    expect(result.kinds).toEqual(['dropped', 'unchanged']);
    expect(result.interdiff).toMatchObject({ kind: 'rebased', replay: 'commit-pairs', files: [] });

    const rangeOnly = value(await computeInterdiff(git, reviewedPr2(), { base: parentTip, head }));
    expect(rangeOnly).toMatchObject({
      kind: 'fallback',
      reason: { kind: 'conflicts', paths: ['b.txt'] },
    });
  });

  it('falls back when the paired replay conflicts too', async () => {
    repo.git('switch', '--quiet', 'pr1');
    const parentTip = stack.commitLine('b.txt', 20, 'parent-b20', 'pr1: b20');
    repo.git('switch', '--quiet', 'pr2');
    repo.git('rebase', '--quiet', '--strategy-option=theirs', 'pr1');

    const result = await review(reviewedPr2(), parentTip, sha('pr2'));
    expect(result.interdiff).toMatchObject({
      kind: 'fallback',
      reason: { kind: 'conflicts', paths: ['b.txt'] },
    });
    expect(result.kinds).toEqual(['unchanged', 'modified']);
    expect(result.pairs.pairs[1]).toMatchObject({
      interdiff: { kind: 'conflicts', paths: ['b.txt'] },
    });
  });
});

function at(commits: readonly CommitSha[], index: number): CommitSha {
  const commit = commits[index];
  if (commit === undefined) {
    throw new Error(`no commit ${String(index)}`);
  }
  return commit;
}

function value<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
}

function summary(files: readonly DiffFile[]): [string, string[]][] {
  return files.map((file) => [
    'path' in file ? file.path : file.newPath,
    file.hunks.flatMap((hunk) =>
      hunk.lines
        .filter((line) => line.kind !== 'context')
        .map((line) => `${line.kind === 'added' ? '+' : '-'}${line.content}`),
    ),
  ]);
}
