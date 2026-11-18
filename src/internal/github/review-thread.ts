/** One comment in a review thread; `body` is untrusted Markdown. */
export interface ReviewThreadComment {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  /** An ISO 8601 instant. */
  readonly at: string;
  /** The comment's page on the host. */
  readonly url: string;
}

/**
 * A discussion other reviewers started on lines of a pull request's diff (ADR 0140). The lines are
 * 1-based and inclusive, on `side`, numbered as they are at commit `sha`; a thread on a whole file
 * has none.
 */
export interface ReviewThread {
  readonly id: string;
  readonly path: string;
  readonly side: 'head' | 'base';
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sha: string;
  /** The host no longer shows the thread on its lines: the code under it changed. */
  readonly isOutdated: boolean;
  /** Oldest first, the thread's first comment first. */
  readonly comments: readonly ReviewThreadComment[];
}

/** A pull request's line threads, oldest thread first. `isTruncated` when there were more pages. */
export interface ReviewThreads {
  readonly threads: readonly ReviewThread[];
  readonly isTruncated: boolean;
}
