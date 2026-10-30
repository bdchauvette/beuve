import type { ReviewScope } from '#contract/ipc-contract.ts';
import type { FileAttribution } from '#internal/git/attribute-hunks.ts';
import type { CommitPairs } from '#internal/git/compute-commit-pairs.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { CommitSha } from '#internal/git/object-id.ts';

/** A computed review diff without the session behind it, as the shared range-diff cache keeps it. */
export interface RangeDiff {
  readonly scope: ReviewScope;
  readonly baseSha: CommitSha;
  readonly files: readonly DiffFile[];
  /** Where the change starts, when that isn't the merge-base (a stacked parent, ADR 0054). */
  readonly forkPoint?: StackForkPoint;
  /** For an interdiff whose ranges were short enough to pair (ADR 0054). */
  readonly commitPairs?: CommitPairs;
  /** Aligned with `files`, when `commitPairs` is set. */
  readonly attribution?: readonly FileAttribution[];
}
