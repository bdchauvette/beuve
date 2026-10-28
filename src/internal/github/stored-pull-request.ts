import type { PullRequest, PullRequestRef } from './pull-request.ts';

/**
 * The pull request metadata beuve keeps between runs (ADR 0037): enough to show a pull request
 * session's intent, badges and stack position offline, and to know which head GitHub last
 * reported. `fetchedAt` is when beuve last saw it change.
 */
export interface StoredPullRequest {
  readonly ref: PullRequestRef;
  readonly title: string;
  readonly body: string;
  readonly state: PullRequest['state'];
  readonly isDraft: boolean;
  readonly author: string;
  readonly htmlUrl: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly isCrossRepository: boolean;
  /** GitHub's `updated_at`. */
  readonly updatedAt: string;
  readonly fetchedAt: string;
}

/** A stored row that doesn't describe a pull request; reported rather than cast. */
export interface CorruptPullRequestRow {
  readonly kind: 'corrupt-row';
  readonly table: 'github_pull_requests';
  readonly reason: string;
}
