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

/** A repository a fork was made from, as `GET /repos/{o}/{r}` names it. */
export interface UpstreamRepository {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
}

/**
 * What beuve needs of a repository to follow one of its branches. A fork also names the
 * repository it was forked from (`parent`) and the root of its fork network (`source`), which
 * are the same for a fork of a repository that is not itself a fork; both are absent otherwise.
 */
export interface RepositoryDetails {
  /** The owner and name as GitHub spells them now (a renamed repository redirects). */
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly parent?: UpstreamRepository;
  readonly source?: UpstreamRepository;
}
