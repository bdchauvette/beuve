import type { QueueCiView } from '#contract/ipc-contract.ts';
import type { RemoteBranchTip, RepositoryDetails } from '#internal/github/branch-ref.ts';
import type { Comparison } from '#internal/github/compare-commits.ts';
import type { CiEtags } from '#internal/github/get-ci-status.ts';
import type { PullRequestReview, ReviewRequests } from '#internal/github/pull-request-review.ts';
import type { PullRequest } from '#internal/github/pull-request.ts';
import type { SearchResults } from '#internal/github/search-pull-requests.ts';

/** A search's last answer and the ETag to ask with. */
export interface CachedSearch {
  readonly etag: string | undefined;
  readonly results: SearchResults;
}

/** A pull request's details, reviews and requests, as of its `updated_at`. */
export interface CachedPull {
  readonly updatedAt: string;
  readonly etag: string | undefined;
  readonly pullRequest: PullRequest;
  readonly reviews: readonly PullRequestReview[];
  readonly requests: ReviewRequests;
}

/** CI of one head, with the ETags to ask again. */
export interface CachedCi {
  readonly sha: string;
  readonly etags: CiEtags | undefined;
  readonly ci: QueueCiView;
}

/** A prefix's branches in one repository. */
export interface CachedBranches {
  readonly etag: string | undefined;
  readonly tips: readonly RemoteBranchTip[];
}

/** The head branches of a repository's open pull requests. */
export interface CachedOpenPulls {
  readonly etag: string | undefined;
  readonly heads: ReadonlySet<string>;
}

/** A branch compared with the default branch, for one head. */
export interface CachedComparison {
  readonly base: string;
  readonly headSha: string;
  readonly comparison: Comparison;
}

/**
 * What the review queue remembers between refreshes (ADR 0113), in memory for the run: the last
 * answer of each source and the ETag or `updated_at` it is good for. Keys are lowercase
 * `host/owner/repo`, an item key, or `host query` for searches.
 */
export interface QueueCache {
  /** The signed-in login per host; `undefined` when it could not be told. */
  readonly viewers: Map<string, string | undefined>;
  readonly searches: Map<string, CachedSearch>;
  readonly pulls: Map<string, CachedPull>;
  readonly ci: Map<string, CachedCi>;
  readonly repositories: Map<string, RepositoryDetails>;
  /** By repository key and prefix. */
  readonly branches: Map<string, CachedBranches>;
  readonly openPulls: Map<string, CachedOpenPulls>;
  /** By repository key and branch. */
  readonly comparisons: Map<string, CachedComparison>;
}

/** An empty cache. */
export function createQueueCache(): QueueCache {
  return {
    viewers: new Map(),
    searches: new Map(),
    pulls: new Map(),
    ci: new Map(),
    repositories: new Map(),
    branches: new Map(),
    openPulls: new Map(),
    comparisons: new Map(),
  };
}
