export type CiBucket = 'pending' | 'success' | 'failure' | 'neutral';

/** One check run (GitHub Checks API) or commit status (Statuses API) on a commit. */
export interface CiCheck {
  readonly source: 'check-run' | 'status';
  /** The check run's name, or the status's context. */
  readonly name: string;
  readonly status: 'queued' | 'in-progress' | 'completed';
  /** GitHub's conclusion (`success`, `failure`, `timed_out`, …) or status state, once completed. */
  readonly conclusion: string | undefined;
  readonly bucket: CiBucket;
  readonly url: string | undefined;
  readonly startedAt: string | undefined;
  readonly completedAt: string | undefined;
}

export interface CiRollup {
  /** `none` when the commit has no checks at all. */
  readonly overall: CiBucket | 'none';
  readonly counts: Readonly<Record<CiBucket, number>>;
}

export interface CiStatus {
  readonly sha: string;
  readonly checks: readonly CiCheck[];
  readonly rollup: CiRollup;
  /** More check runs existed than were fetched. */
  readonly isTruncated: boolean;
}
