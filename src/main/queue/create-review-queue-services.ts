import type { IpcResult, ReviewQueueView } from '#contract/ipc-contract.ts';
import { ok } from '#x/result/ok.ts';
import { multiplyDuration } from '#x/time/multiply-duration.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { GithubContext } from '../github/github-context.ts';

import { createQueueCache } from './create-queue-cache.ts';
import { queueDelayFrom } from './queue-delay-from.ts';
import { refreshReviewQueue } from './refresh-review-queue.ts';

/** The review queue as the renderer reaches it (ADR 0113). */
export interface ReviewQueueServices {
  /** The current snapshot; starts polling, and a refresh when it is stale or there is none. */
  readonly get: () => Promise<IpcResult<ReviewQueueView>>;
  /** Refreshes now and answers the result, unless search ran moments ago (the search floor). */
  readonly refresh: () => Promise<IpcResult<ReviewQueueView>>;
  /** A focused window refreshes on the interval; a blurred one five times less often. */
  readonly setForeground: (isForeground: boolean) => void;
  readonly onUpdated: (listener: (event: ReviewQueueView) => void) => () => void;
  readonly dispose: () => void;
}

export interface ReviewQueueServicesOptions {
  readonly context: GithubContext;
  /** The branch prefixes to list, read before each refresh (display preferences). */
  readonly branchPrefixes: () => Promise<readonly string[]>;
  readonly polling?: {
    /** Between refreshes of a focused window; 5 minutes by default. */
    readonly interval?: Temporal.Duration;
    /** The least time between two rounds of searches; 20 s by default (30 searches a minute). */
    readonly searchFloor?: Temporal.Duration;
    /** Off in tests, which call `refresh`. */
    readonly scheduled?: boolean;
  };
}

const backgroundFactor = 5;

/**
 * The review queue's poller (ADR 0113), apart from the session poller (ADR 0038): it starts when
 * the renderer first asks, refreshes on the interval (five times slower without focus, at once on
 * focus when stale), backs off on failure and waits out rate limits, and pushes every change of
 * the snapshot. Timers are unref'd and disposing aborts the refresh in flight.
 */
export function createReviewQueueServices(
  options: ReviewQueueServicesOptions,
): ReviewQueueServices {
  const { context } = options;
  const { logger } = context.session;
  const interval = options.polling?.interval ?? Temporal.Duration.from({ minutes: 5 });
  const searchFloor = options.polling?.searchFloor ?? Temporal.Duration.from({ seconds: 20 });
  const isScheduled = options.polling?.scheduled ?? true;
  const cache = createQueueCache();
  const listeners = new Set<(event: ReviewQueueView) => void>();
  const disposal = new AbortController();
  let snapshot: ReviewQueueView = { items: [], problems: [], isRefreshing: false };
  let lastRefresh: Stopwatch | undefined;
  let inFlight: Promise<void> | undefined;
  let failures = 0;
  let isStarted = false;
  let isForeground = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = (next: ReviewQueueView): void => {
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error: unknown) {
        logger.warn('review queue listener failed', { error });
      }
    }
  };

  const schedule = (delay: Temporal.Duration): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!isScheduled || !isStarted || disposal.signal.aborted) {
      return;
    }
    let paced = delay;
    if (!isForeground) {
      paced = multiplyDuration(delay, backgroundFactor);
    }
    timer = setTimeout(() => {
      void refreshShared();
    }, paced.total('milliseconds'));
    timer.unref();
  };

  const runRefresh = async (): Promise<void> => {
    lastRefresh = new Stopwatch();
    publish({ ...snapshot, isRefreshing: true });
    let delay: Temporal.Duration;
    try {
      const refreshed = await refreshReviewQueue({
        context,
        cache,
        branchPrefixes: await options.branchPrefixes(),
        signal: disposal.signal,
      });
      const isFailed =
        refreshed.items.length === 0 &&
        refreshed.problems.some((problem) => problem.kind === 'failed');
      if (isFailed) {
        failures += 1;
      } else {
        failures = 0;
      }
      delay = queueDelayFrom({
        interval,
        failures,
        rateLimitedUntil: refreshed.rateLimitedUntil,
      });
      publish({
        items: refreshed.items,
        problems: refreshed.problems,
        refreshedAt: Temporal.Now.instant().toString(),
        isRefreshing: false,
      });
    } catch (error: unknown) {
      logger.error('review queue refresh failed', { error });
      failures += 1;
      delay = queueDelayFrom({ interval, failures, rateLimitedUntil: undefined });
      publish({ ...snapshot, isRefreshing: false });
    }
    schedule(delay);
  };

  /** One refresh at a time; a call inside the search floor joins nothing and refreshes nothing. */
  const refreshShared = async (): Promise<void> => {
    if (inFlight !== undefined) {
      return inFlight;
    }
    if (
      lastRefresh !== undefined &&
      Temporal.Duration.compare(lastRefresh.elapsed(), searchFloor) < 0
    ) {
      return undefined;
    }
    inFlight = (async (): Promise<void> => {
      try {
        await runRefresh();
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const isStale = (): boolean => {
    return (
      lastRefresh === undefined || Temporal.Duration.compare(lastRefresh.elapsed(), interval) >= 0
    );
  };

  return {
    get: async (): Promise<IpcResult<ReviewQueueView>> => {
      isStarted = true;
      if (isStale()) {
        void refreshShared();
      }
      await Promise.resolve();
      return ok(snapshot);
    },
    refresh: async (): Promise<IpcResult<ReviewQueueView>> => {
      isStarted = true;
      await refreshShared();
      return ok(snapshot);
    },
    setForeground: (isNowForeground): void => {
      const wasBackground = !isForeground;
      isForeground = isNowForeground;
      if (!isStarted || !isNowForeground || !wasBackground) {
        return;
      }
      if (isStale()) {
        void refreshShared();
        return;
      }
      schedule(interval.subtract(lastRefresh?.elapsed() ?? new Temporal.Duration()));
    },
    onUpdated: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    dispose: (): void => {
      clearTimeout(timer);
      disposal.abort();
    },
  };
}
