import type {
  AttentionView,
  CiStatusChangedView,
  PullRequestStackView,
  PullRequestUpdatedView,
  CiStatusView,
} from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import { findPullRequestStack } from '#internal/github/find-pull-request-stack.ts';
import { findStoredPullRequest } from '#internal/github/find-stored-pull-request.ts';
import { getCiStatus } from '#internal/github/get-ci-status.ts';
import type { CiEtags } from '#internal/github/get-ci-status.ts';
import { getPullRequest } from '#internal/github/get-pull-request.ts';
import { getPullRequestReviews } from '#internal/github/get-pull-request-reviews.ts';
import { getReviewRequests } from '#internal/github/get-review-requests.ts';
import type { PullRequestReview, ReviewRequests } from '#internal/github/pull-request-review.ts';
import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';
import { savePullRequest } from '#internal/github/save-pull-request.ts';
import type { Session } from '#internal/session/session.ts';

import { loadSession } from '../sessions/load-session.ts';
import { openSessionRepository } from '../sessions/open-session-repository.ts';

import { fetchPullRequest } from './fetch-pull-request.ts';
import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';
import { moveSessionHead } from './move-session-head.ts';
import { syncPullRequestHead } from './sync-pull-request-head.ts';
import { attentionViewFrom } from './attention-view-from.ts';
import { ciStatusViewFrom } from './ci-status-view-from.ts';
import { pullRequestViewFrom } from './pull-request-view-from.ts';
import { stackViewFrom } from './stack-view-from.ts';
import { multiplyDuration } from '#x/time/multiply-duration.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

/**
 * Keeps the open pull request session in step with GitHub (ADR 0038): one session at a time,
 * conditional requests, a new head fetched, verified and stored with `advanceHead`, CI pushed.
 */
export interface PullRequestPoller {
  /** Polls this session from now on (at once, then on the interval); `undefined` stops. */
  readonly watch: (sessionId: string | undefined) => void;
  /** One poll now, joining one already running. Resolves when it is done. Never rejects. */
  readonly pollNow: (sessionId: string) => Promise<void>;
  /** A focused window polls on the interval; a blurred one five times less often. */
  readonly setForeground: (isForeground: boolean) => void;
  /** The last CI status and stack seen for a session in this run. */
  readonly snapshot: (sessionId: string) => {
    readonly ci?: CiStatusView;
    readonly stack?: PullRequestStackView;
    readonly attention?: AttentionView;
  };
  /** Remembers a stack found elsewhere (when the pull request was opened). */
  readonly rememberStack: (sessionId: string, stack: PullRequestStackView) => void;
  readonly onUpdated: (listener: (event: PullRequestUpdatedView) => void) => () => void;
  readonly onCiStatus: (listener: (event: CiStatusChangedView) => void) => () => void;
  readonly dispose: () => void;
}

export interface PullRequestPollerOptions {
  readonly context: GithubContext;
  /** Between polls of a focused window. Defaults to 60 s. */
  readonly interval?: Temporal.Duration;
  /** Off in tests, which call `pollNow`; `watch` then only records the session. */
  readonly scheduled?: boolean;
}

interface PollState {
  prEtag?: string | undefined;
  /**
   * The session head as this poller last left it. A different stored head means another writer
   * moved it, so `prEtag` no longer describes what is stored and must not 304 the next poll.
   */
  headSeen?: string | undefined;
  ciSha?: string;
  ciEtags?: CiEtags | undefined;
  ci?: CiStatusView;
  stack?: PullRequestStackView;
  /** What the attention rules read (ADR 0066); set once the reviews have been fetched. */
  reviews?: readonly PullRequestReview[];
  requests?: ReviewRequests;
  /** The signed-in login, once asked for (`login` is absent when it could not be told). */
  viewer?: { readonly login: string | undefined };
  attention?: AttentionView;
  failures: number;
  /** Measures the time since the last poll started. */
  lastPolled: Stopwatch | undefined;
}

const backgroundFactor = 5;
const maxBackoff = Temporal.Duration.from({ minutes: 15 });

/** Creates the poller. Timers are unref'd, so polling never keeps the process alive. */
export function createPullRequestPoller(options: PullRequestPollerOptions): PullRequestPoller {
  const { context } = options;
  const { logger } = context.session;
  const interval = options.interval ?? Temporal.Duration.from({ seconds: 60 });
  const isScheduled = options.scheduled ?? true;
  const states = new Map<string, PollState>();
  const inFlight = new Map<string, Promise<Temporal.Duration>>();
  const updatedListeners = new Set<(event: PullRequestUpdatedView) => void>();
  const ciListeners = new Set<(event: CiStatusChangedView) => void>();
  let watched: string | undefined;
  let isForeground = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let isDisposed = false;
  /** Aborts the requests and fetches still running when the poller is disposed. */
  const disposal = new AbortController();

  const stateOf = (sessionId: string): PollState => {
    const existing = states.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created: PollState = { failures: 0, lastPolled: undefined };
    states.set(sessionId, created);
    return created;
  };

  const emit = <T>(listeners: ReadonlySet<(event: T) => void>, event: T): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        logger.warn('github poll listener failed', { error });
      }
    }
  };

  /** The delay after a failed request: `resetAt` for rate limits, else doubling backoff. */
  const failed = (
    state: PollState,
    error: { readonly kind: string; readonly resetAt?: string | undefined },
  ): Temporal.Duration => {
    state.failures += 1;
    if (error.kind === 'rate-limited' && error.resetAt !== undefined) {
      const untilReset = Temporal.Now.instant()
        .until(Temporal.Instant.from(error.resetAt))
        .add({ seconds: 1 });
      const [, clamped = interval] = [interval, untilReset, maxBackoff].toSorted((a, b) => {
        return Temporal.Duration.compare(a, b);
      });
      return clamped;
    }
    let backoff = interval;
    for (let doubled = 0; doubled < state.failures; doubled += 1) {
      if (Temporal.Duration.compare(backoff, maxBackoff) >= 0) {
        break;
      }
      backoff = backoff.add(backoff);
    }
    return Temporal.Duration.compare(backoff, maxBackoff) < 0 ? backoff : maxBackoff;
  };

  /** Reads the reviews and review requests; keeps the old ones when GitHub does not answer. */
  const readReviews = async (state: PollState, ref: PullRequestRef): Promise<void> => {
    const [reviews, requests] = await Promise.all([
      context.clients.withClient(ref.host, async (client) => {
        return getPullRequestReviews(client, ref, { signal: disposal.signal });
      }),
      context.clients.withClient(ref.host, async (client) => {
        return getReviewRequests(client, ref, { signal: disposal.signal });
      }),
    ]);
    if (reviews.ok && requests.ok) {
      state.reviews = reviews.value;
      state.requests = requests.value;
    } else {
      logger.info('github poll: reviews unavailable');
    }
    if (state.viewer !== undefined) {
      return;
    }
    const described = await context.clients.credentials.describe({ host: ref.host });
    state.viewer = { login: described.ok ? described.value.account?.login : undefined };
  };

  /** Recomputes the attention; true when it differs from the one last computed. */
  const isAttentionChanged = (state: PollState, ref: PullRequestRef): boolean => {
    const stored = findStoredPullRequest(context.session.db, ref);
    if (!stored.ok || stored.value === undefined || state.reviews === undefined) {
      return false;
    }
    const next = attentionViewFrom(stored.value, {
      viewer: state.viewer?.login,
      reviews: state.reviews,
      requests: state.requests ?? { users: [], teams: [] },
      ci: state.ci,
    });
    const previous = state.attention;
    state.attention = next;
    return previous?.turn !== next.turn || previous.reasons.join('\n') !== next.reasons.join('\n');
  };

  /** Fetches and verifies the new head and moves the session to it; answers the head it moved to. */
  const moveHead = async (
    session: Session,
    ref: PullRequestRef,
    pullRequest: PullRequest,
  ): Promise<string | undefined> => {
    const repository = await openSessionRepository(
      context.session,
      session.source.repoPath,
      disposal.signal,
    );
    if (!repository.ok) {
      logger.warn('github poll: clone unavailable', { error: repository.error });
      return undefined;
    }
    const remotes = await listRemoteUrls(repository.value);
    const remote = remotes.ok ? findMatchingRemote(remotes.value, ref) : undefined;
    if (remote === undefined) {
      logger.warn('github poll: no remote for the pull request', { ref });
      return undefined;
    }
    const synced = await syncPullRequestHead({
      repository: repository.value,
      remote: remote.name,
      pullRequest,
      refetch: async () => {
        return fetchPullRequest(context.clients, ref, disposal.signal);
      },
      logger,
      signal: disposal.signal,
    });
    if (!synced.ok) {
      logger.warn('github poll: new head not fetched', { failure: synced.error });
      return undefined;
    }
    if (synced.value.pullRequest !== pullRequest) {
      savePullRequest(context.session.db, ref, synced.value.pullRequest);
    }
    return moveSessionHead(context.session, session, synced.value.headSha).ok
      ? synced.value.headSha
      : undefined;
  };

  const emitUpdated = (
    sessionId: string,
    ref: PullRequestRef,
    state: PollState,
    isHeadMoved: boolean,
  ): void => {
    const stored = findStoredPullRequest(context.session.db, ref);
    if (!stored.ok || stored.value === undefined) {
      return;
    }
    emit(updatedListeners, {
      sessionId,
      pullRequest: pullRequestViewFrom(stored.value),
      stack: state.stack ?? { parents: [], children: [] },
      headMoved: isHeadMoved,
      ...(state.attention !== undefined && { attention: state.attention }),
    });
  };

  const pollOnce = async (sessionId: string): Promise<Temporal.Duration> => {
    const state = stateOf(sessionId);
    state.lastPolled = new Stopwatch();
    const loaded = loadSession(context.session, sessionId);
    if (!loaded.ok) {
      return interval;
    }
    const session = loaded.value;
    const { source } = session;
    if (source.kind !== 'github-pull-request') {
      return interval;
    }
    const { host, owner, repo, number } = source;
    const ref: PullRequestRef = { host, owner, repo, number };
    if (state.headSeen !== undefined && state.headSeen !== session.headSha) {
      state.prEtag = undefined;
    }
    const pulled = await context.clients.withClient(host, async (client) => {
      return getPullRequest(client, ref, {
        ...(state.prEtag !== undefined && { etag: state.prEtag }),
        signal: disposal.signal,
      });
    });
    if (!pulled.ok) {
      logger.info('github poll: pull request unavailable', { kind: pulled.error.kind });
      return failed(state, pulled.error);
    }
    let headSha: string = session.headSha;
    state.headSeen ??= headSha;
    if (pulled.value.kind === 'modified') {
      const pullRequest = pulled.value.value;
      savePullRequest(context.session.db, ref, pullRequest);
      const stack = await context.clients.withClient(host, async (client) => {
        return findPullRequestStack(client, pullRequest, disposal.signal);
      });
      if (stack.ok) {
        state.stack = stackViewFrom(host, stack.value);
      }
      await readReviews(state, ref);
      const isNewHead = pullRequest.head.sha !== session.headSha;
      // The synced head, which can be newer than this answer's when GitHub was asked again.
      const movedTo = isNewHead ? await moveHead(session, ref, pullRequest) : undefined;
      const hasHeadMoved = movedTo !== undefined;
      // A head that couldn't be fetched is asked for unconditionally next time, not 304'd past.
      state.prEtag = isNewHead && !hasHeadMoved ? undefined : pulled.value.etag;
      headSha = movedTo ?? headSha;
      state.headSeen = headSha;
      isAttentionChanged(state, ref);
      emitUpdated(sessionId, ref, state, hasHeadMoved);
    }
    if (state.ciSha !== headSha) {
      state.ciSha = headSha;
      delete state.ciEtags;
    }
    const ci = await context.clients.withClient(host, async (client) => {
      return getCiStatus(
        client,
        { owner, repo, sha: headSha },
        { ...(state.ciEtags !== undefined && { etags: state.ciEtags }), signal: disposal.signal },
      );
    });
    if (!ci.ok) {
      logger.info('github poll: CI status unavailable', { kind: ci.error.kind });
      return failed(state, ci.error);
    }
    if (ci.value.kind === 'modified') {
      state.ciEtags = ci.value.etags;
      state.ci = ciStatusViewFrom(ci.value.value);
      emit(ciListeners, { sessionId, ci: state.ci });
      if (isAttentionChanged(state, ref)) {
        emitUpdated(sessionId, ref, state, false);
      }
    }
    state.failures = 0;
    return interval;
  };

  const pollShared = async (sessionId: string): Promise<Temporal.Duration> => {
    const running = inFlight.get(sessionId);
    if (running !== undefined) {
      return running;
    }
    const started = (async (): Promise<Temporal.Duration> => {
      try {
        return await pollOnce(sessionId);
      } catch (error: unknown) {
        logger.error('github poll failed', { error });
        return interval;
      } finally {
        inFlight.delete(sessionId);
      }
    })();
    inFlight.set(sessionId, started);
    return started;
  };

  const schedule = (delay: Temporal.Duration): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!isScheduled || isDisposed || watched === undefined) {
      return;
    }
    const sessionId = watched;
    timer = setTimeout(() => {
      void (async (): Promise<void> => {
        const next = await pollShared(sessionId);
        if (watched === sessionId) {
          schedule(isForeground ? next : multiplyDuration(next, backgroundFactor));
        }
      })();
    }, delay.total('milliseconds'));
    timer.unref();
  };

  return {
    watch: (sessionId): void => {
      if (sessionId === watched) {
        return;
      }
      watched = sessionId;
      schedule(new Temporal.Duration());
    },
    pollNow: async (sessionId): Promise<void> => {
      await pollShared(sessionId);
    },
    setForeground: (isNowForeground): void => {
      const wasBackground = !isForeground;
      isForeground = isNowForeground;
      if (!isNowForeground || !wasBackground || watched === undefined) {
        return;
      }
      const last = stateOf(watched).lastPolled;
      const remaining =
        last === undefined ? new Temporal.Duration() : interval.subtract(last.elapsed());
      schedule(remaining.sign < 0 ? new Temporal.Duration() : remaining);
    },
    snapshot: (sessionId): ReturnType<PullRequestPoller['snapshot']> => {
      const state = states.get(sessionId);
      return {
        ...(state?.ci !== undefined && { ci: state.ci }),
        ...(state?.stack !== undefined && { stack: state.stack }),
        ...(state?.attention !== undefined && { attention: state.attention }),
      };
    },
    rememberStack: (sessionId, stack): void => {
      stateOf(sessionId).stack = stack;
    },
    onUpdated: (listener): (() => void) => {
      updatedListeners.add(listener);
      return (): void => {
        updatedListeners.delete(listener);
      };
    },
    onCiStatus: (listener): (() => void) => {
      ciListeners.add(listener);
      return (): void => {
        ciListeners.delete(listener);
      };
    },
    dispose: (): void => {
      isDisposed = true;
      clearTimeout(timer);
      disposal.abort();
    },
  };
}
