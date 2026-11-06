/** A branch of a GitHub repository: `owner/repo:branch` on `host` (ADR 0112). */
export interface BranchRef {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  /** The branch name, e.g. `claude/fix-login` (not `refs/heads/…`). */
  readonly branch: string;
}

/** What GitHub reports of a branch: its name and tip. */
export interface RemoteBranchTip {
  readonly name: string;
  /** Full commit id, lowercase. */
  readonly sha: string;
}

/** What beuve needs of a repository to follow one of its branches. */
export interface RepositoryDetails {
  /** The owner and name as GitHub spells them now (a renamed repository redirects). */
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
}
