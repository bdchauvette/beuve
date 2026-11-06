/** Where a pull request lives: `owner/repo#number` on `host`. */
export interface PullRequestRef {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface RepositoryInfo {
  readonly owner: string;
  readonly name: string;
  /** `owner/name`, as GitHub spells it. */
  readonly fullName: string;
  /** The HTTPS clone URL, without credentials. */
  readonly cloneUrl: string;
}

export interface BranchTip {
  /** The branch name, e.g. `main` (not `refs/heads/main`). */
  readonly ref: string;
  /** Full 40-hex commit id, lowercase. */
  readonly sha: string;
  /** `undefined` for the head of a pull request whose fork was deleted. */
  readonly repository: RepositoryInfo | undefined;
}

/**
 * A pull request as beuve needs it (ADR 0035). `state` folds GitHub's `state` and `merged_at`.
 * `mergeable` is `unknown` while GitHub computes it, and on list endpoints, which omit it.
 */
export interface PullRequest {
  readonly number: number;
  readonly title: string;
  /** Markdown, `''` when the author left it empty; the source for intent extraction. */
  readonly body: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly isDraft: boolean;
  /** The author's login, `ghost` for a deleted account. */
  readonly author: string;
  readonly base: BranchTip;
  readonly head: BranchTip;
  /** The head lives in another repository (a fork), or its fork was deleted. */
  readonly isCrossRepository: boolean;
  readonly mergeable: 'mergeable' | 'conflicting' | 'unknown';
  /** GitHub's `mergeable_state` (`clean`, `blocked`, `behind`, `dirty`, …) when present. */
  readonly mergeableState: string | undefined;
  readonly htmlUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Lines and files changed; only `GET …/pulls/{n}` reports it, list endpoints don't. */
  readonly size?: ChangeSize;
}

/** How big a change is, as GitHub counts it. */
export interface ChangeSize {
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
}
