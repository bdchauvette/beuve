import type { QueueCiView } from '#contract/ipc-contract.ts';
import { getPullRequest } from '#internal/github/get-pull-request.ts';
import { getPullRequestReviews } from '#internal/github/get-pull-request-reviews.ts';
import { getReviewRequests } from '#internal/github/get-review-requests.ts';
import type { ReviewRequestEvent } from '#internal/github/list-review-request-events.ts';
import type { SearchedPullRequest } from '#internal/github/search-pull-requests.ts';

import type { CachedPull, QueueCache } from './create-queue-cache.ts';
import type { QueueRun } from './queue-run.ts';
import { readQueueCi } from './read-queue-ci.ts';
import { readRequestEvents } from './read-request-events.ts';

/** A searched pull request to read the details of. */
export interface PullToEnrich {
  readonly host: string;
  readonly key: string;
  readonly pull: SearchedPullRequest;
  /** Its review was requested of the viewer, so when matters (ADR 0113 amendment). */
  readonly isRequested: boolean;
  readonly cache: QueueCache;
}

/** What the queue knows of a pull request beyond the search: details, reviews, CI and requests. */
export interface EnrichedPull {
  readonly details: CachedPull | undefined;
  readonly ci: QueueCiView | undefined;
  /** Its review requests, oldest first; read only for requested reviews. */
  readonly requestEvents: readonly ReviewRequestEvent[] | undefined;
}

/**
 * Reads what a queued pull request's row needs beyond the search (ADR 0113): its details (size,
 * head, branches), reviews, requested reviewers and, for a requested review, its review requests
 * only when its `updated_at` moved, and its CI on every refresh with the last ETags, which mostly
 * answer 304. A failed read is reported and the last answer kept.
 */
export async function enrichPullRequest(
  run: QueueRun,
  target: PullToEnrich,
): Promise<EnrichedPull> {
  const { host, key, pull, cache } = target;
  const readEvents = async (): Promise<readonly ReviewRequestEvent[] | undefined> => {
    if (!target.isRequested) {
      return undefined;
    }
    return readRequestEvents(run, { host, key, pull, cache });
  };
  const [details, requestEvents] = await Promise.all([readDetails(run, target), readEvents()]);
  if (details === undefined) {
    return { details, ci: undefined, requestEvents };
  }
  const ci = await readQueueCi(run, {
    host,
    key,
    owner: pull.owner,
    repo: pull.repo,
    sha: details.pullRequest.head.sha,
    cache,
  });
  return { details, ci, requestEvents };
}

async function readDetails(
  run: QueueRun,
  { host, key, pull, cache }: PullToEnrich,
): Promise<CachedPull | undefined> {
  const cached = cache.pulls.get(key);
  if (cached?.updatedAt === pull.updatedAt) {
    return cached;
  }
  const ref = { owner: pull.owner, repo: pull.repo, number: pull.number };
  const options = { signal: run.signal };
  const [answer, reviews, requests] = await Promise.all([
    run.withClient(host, async (client) => {
      return getPullRequest(client, ref, {
        ...(cached?.etag !== undefined && { etag: cached.etag }),
        ...options,
      });
    }),
    run.withClient(host, async (client) => {
      return getPullRequestReviews(client, ref, options);
    }),
    run.withClient(host, async (client) => {
      return getReviewRequests(client, ref, options);
    }),
  ]);
  if (!answer.ok) {
    run.report(key, answer.error);
    return cached;
  }
  if (!reviews.ok) {
    run.report(key, reviews.error);
    return cached;
  }
  if (!requests.ok) {
    run.report(key, requests.error);
    return cached;
  }
  let pullRequest = cached?.pullRequest;
  let { etag } = cached ?? {};
  if (answer.value.kind === 'modified') {
    pullRequest = answer.value.value;
    etag = answer.value.etag;
  }
  if (pullRequest === undefined) {
    return cached;
  }
  const next: CachedPull = {
    updatedAt: pull.updatedAt,
    etag,
    pullRequest,
    reviews: reviews.value,
    requests: requests.value,
  };
  cache.pulls.set(key, next);
  return next;
}
