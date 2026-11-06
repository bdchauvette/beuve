import { listReviewRequestEvents } from '#internal/github/list-review-request-events.ts';
import type { ReviewRequestEvent } from '#internal/github/list-review-request-events.ts';
import type { SearchedPullRequest } from '#internal/github/search-pull-requests.ts';

import type { QueueCache } from './create-queue-cache.ts';
import type { QueueRun } from './queue-run.ts';

/** A requested pull request whose review requests to read. */
export interface RequestEventsTarget {
  readonly host: string;
  readonly key: string;
  readonly pull: SearchedPullRequest;
  readonly cache: QueueCache;
}

/**
 * The review requests of a pull request the viewer was asked to review (ADR 0113 amendment), read
 * again only when its `updated_at` moved (a new request moves it). `undefined` when they could not
 * be read, which is reported, or when GitHub had more events than are read.
 */
export async function readRequestEvents(
  run: QueueRun,
  { host, key, pull, cache }: RequestEventsTarget,
): Promise<readonly ReviewRequestEvent[] | undefined> {
  const cached = cache.requestEvents.get(key);
  if (cached?.updatedAt === pull.updatedAt) {
    return cached.events;
  }
  const answer = await run.withClient(host, async (client) => {
    return listReviewRequestEvents(
      client,
      { owner: pull.owner, repo: pull.repo, number: pull.number },
      { signal: run.signal },
    );
  });
  if (!answer.ok) {
    run.report(key, answer.error);
    return undefined;
  }
  let events: readonly ReviewRequestEvent[] | undefined = answer.value.events;
  if (answer.value.isTruncated) {
    events = undefined;
  }
  cache.requestEvents.set(key, { updatedAt: pull.updatedAt, events });
  return events;
}
