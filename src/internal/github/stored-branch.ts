import type { BranchRef } from './branch-ref.ts';
import type { RepositoryName } from './get-repository.ts';

/** A pull request found for a followed branch: its number in its base repository. */
export interface BranchPullRequestRef {
  /** The branch's own repository, or an upstream of its fork. */
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * What beuve keeps of a followed branch between runs (ADR 0112). `state` is `gone` once GitHub
 * answered 404 for it; `headSha` is then the last head beuve saw. `parent` and `source` are the
 * repositories a fork was forked from, as GitHub named them when the branch was last opened; both
 * are `undefined` when the branch's repository is not a fork. `pullRequest` is the open pull
 * request found for the branch while the session could not become its session: another session
 * already reviews it, or the clone has no remote for its repository (otherwise the session was
 * promoted). `fetchedAt` is when beuve last saw it change.
 */
export interface StoredBranch {
  readonly ref: BranchRef;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly parent: RepositoryName | undefined;
  readonly source: RepositoryName | undefined;
  readonly headSha: string;
  readonly state: 'present' | 'gone';
  readonly pullRequest: BranchPullRequestRef | undefined;
  readonly fetchedAt: string;
}

/** A stored row that doesn't describe a branch; reported rather than cast. */
export interface CorruptBranchRow {
  readonly kind: 'corrupt-row';
  readonly table: 'github_branches';
  readonly reason: string;
}
