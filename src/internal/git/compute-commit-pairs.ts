import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { DiffFile } from './diff-model.ts';
import { diffObjects } from './diff-objects.ts';
import type { DiffObjectsOptions } from './diff-objects.ts';
import type { GitError } from './git-error.ts';
import { listRangeCommits } from './list-range-commits.ts';
import type { RangeCommit } from './list-range-commits.ts';
import type { GitRepository } from './open-repository.ts';
import { pairCommits } from './pair-commits.ts';
import type { CommitPairing } from './pair-commits.ts';
import type { GitVersion } from './parse-git-version.ts';
import { replayChanges } from './replay-changes.ts';
import type { ReviewRanges } from './review-range.ts';

/**
 * A pairing, with the per-commit interdiff of a `modified` pair: the previous commit's change
 * replayed onto the new commit's parent, diffed against the new commit. A `modified` pair whose
 * interdiff comes out empty is reported `unchanged`.
 */
export type CommitPair =
  | Exclude<CommitPairing, { kind: 'modified' }>
  | (Extract<CommitPairing, { kind: 'modified' }> & { readonly interdiff: CommitInterdiff });

export type CommitInterdiff =
  | { readonly kind: 'clean'; readonly files: readonly DiffFile[] }
  | { readonly kind: 'conflicts'; readonly paths: readonly string[] }
  | { readonly kind: 'skipped'; readonly reason: 'too-many-pairs' }
  | { readonly kind: 'unsupported'; readonly version: GitVersion; readonly required: string };

export interface CommitPairs {
  readonly pairs: readonly CommitPair[];
  /** The new range's commits, oldest first, for attributing hunks. */
  readonly nextCommits: readonly RangeCommit[];
  /** Either range had more commits than were listed; pairing covers only the newest. */
  readonly truncated: boolean;
}

export interface CommitPairsOptions extends DiffObjectsOptions {
  /** Commits listed per range. Defaults to 100. */
  readonly maxCommits?: number;
  /** Modified pairs that get an interdiff (two git spawns each). Defaults to 25. */
  readonly maxInterdiffs?: number;
}

/**
 * Pairs the commits of a previously reviewed range with those of the new one (both ranges start
 * at their own fork point) like `git range-diff`, and computes an interdiff for each modified
 * pair. Both ranges are read with `git log -p` and `git patch-id --stable`.
 */
export async function computeCommitPairs(
  repository: GitRepository,
  { previous, next }: ReviewRanges,
  options: CommitPairsOptions = {},
): Promise<Result<CommitPairs, GitError>> {
  const listed = await Promise.all([
    listRangeCommits(repository, previous, options),
    listRangeCommits(repository, next, options),
  ]);
  const [previousCommits, nextCommits] = listed;
  if (!previousCommits.ok) {
    return previousCommits;
  }
  if (!nextCommits.ok) {
    return nextCommits;
  }
  const pairings = pairCommits(previousCommits.value.commits, nextCommits.value.commits);
  const maxInterdiffs = options.maxInterdiffs ?? 25;
  const pairs: CommitPair[] = [];
  let interdiffs = 0;
  for (const pairing of pairings) {
    if (pairing.kind !== 'modified') {
      pairs.push(pairing);
      continue;
    }
    if (interdiffs >= maxInterdiffs) {
      pairs.push({ ...pairing, interdiff: { kind: 'skipped', reason: 'too-many-pairs' } });
      continue;
    }
    interdiffs += 1;
    const interdiff = await pairInterdiff(repository, pairing, options);
    if (!interdiff.ok) {
      return interdiff;
    }
    if (interdiff.value.kind === 'clean' && interdiff.value.files.length === 0) {
      pairs.push({ kind: 'unchanged', previous: pairing.previous, next: pairing.next });
    } else {
      pairs.push({ ...pairing, interdiff: interdiff.value });
    }
  }
  return ok({
    pairs,
    nextCommits: nextCommits.value.commits,
    truncated: previousCommits.value.truncated || nextCommits.value.truncated,
  });
}

/** A commit of the previous range and its partner in the next one. */
interface RangeCommitPair {
  readonly previous: RangeCommit;
  readonly next: RangeCommit;
}

async function pairInterdiff(
  repository: GitRepository,
  { previous, next }: RangeCommitPair,
  options: DiffObjectsOptions,
): Promise<Result<CommitInterdiff, GitError>> {
  const replay = await replayChanges(repository, {
    from: previous.parent,
    to: previous.sha,
    onto: next.parent,
  });
  if (!replay.ok) {
    return replay;
  }
  const outcome = replay.value;
  switch (outcome.kind) {
    case 'clean': {
      const files = await diffObjects(
        repository,
        { from: outcome.tree, to: next.sha },
        {
          ...(options.contextLines !== undefined && { contextLines: options.contextLines }),
          ...(options.ignoreWhitespace !== undefined && {
            ignoreWhitespace: options.ignoreWhitespace,
          }),
        },
      );
      if (files.ok) {
        return ok({ kind: 'clean', files: files.value });
      }
      return files;
    }
    case 'conflicted': {
      return ok({ kind: 'conflicts', paths: outcome.paths });
    }
    case 'unsupported': {
      return ok({ kind: 'unsupported', version: outcome.version, required: outcome.required });
    }
  }
}
