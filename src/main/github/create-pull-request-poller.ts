import type {
  CiStatusChangedView,
  PullRequestStackView,
  PullRequestUpdatedView,
  CiStatusView,
} from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import { findPullRequestStack } from '#internal/github/find-pull-request-stack.ts';
import { findStoredPullRequest } from '#internal/github/find-stored-pull-request.ts';
import { getCiStatus } from '#internal/github/get-ci-status.ts';
import type { CiEtags } from '#internal/github/get-ci-status.ts';
import { getPullRequest } from '#internal/github/get-pull-request.ts';
import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';
import { savePullRequest } from '#internal/github/save-pull-request.ts';
import type { Session } from '#internal/session/session.ts';

import { loadSession } from '../sessions/load-session.ts';

import { fetchPullRequest } from './fetch-pull-request.ts';
import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';
import { moveSessionHead } from './move-session-head.ts';
import { syncPullRequestHead } from './sync-pull-request-head.ts';
import { toCiStatusView } from './to-ci-status-view.ts';
import { toPullRequestView } from './to-pull-request-view.ts';
import { toStackView } from './to-stack-view.ts';

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
  readonly intervalMs?: number;
  /** Off in tests, which call `pollNow`; `watch` then only records the session. */
  readonly scheduled?: boolean;
}

interface PollState {
  prEtag?: string | undefined;
  ciSha?: string;
  ciEtags?: CiEtags | undefined;
  ci?: CiStatusView;
  stack?: PullRequestStackView;
  failures: number;
  lastPolledAt: Temporal.Instant | undefined;
}

const backgroundFactor = 5;
const maxBackoffMs = 15 * 60_000;

/** Creates the poller. Timers are unref'd, so polling never keeps the process alive. */
export function createPullRequestPoller(options: PullRequestPollerOptions): PullRequestPoller {
  const { context } = options;
  const { logger } = context.session;
  const intervalMs = options.intervalMs ?? 60_000;
  const isScheduled = options.scheduled ?? true;
  const states = new Map<string, PollState>();
  const inFlight = new Map<string, Promise<number>>();
  const updatedListeners = new Set<(event: PullRequestUpdatedView) => void>();
  const ciListeners = new Set<(event: CiStatusChangedView) => void>();
  let watched: string | undefined;
  let isForeground = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let isDisposed = false;

  const stateOf = (sessionId: string): PollState => {
    const existing = states.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created: PollState = { failures: 0, lastPolledAt: undefined };
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
  ): number => {
    state.failures += 1;
    if (error.kind === 'rate-limited' && error.resetAt !== undefined) {
      const untilReset = Temporal.Now.instant()
        .until(Temporal.Instant.from(error.resetAt))
        .add({ seconds: 1 });
      const floor = Temporal.Duration.from({ milliseconds: intervalMs });
      const ceiling = Temporal.Duration.from({ milliseconds: maxBackoffMs });
      const [, clamped = floor] = [floor, untilReset, ceiling].toSorted((a, b) =>
        Temporal.Duration.compare(a, b),
      );
      return clamped.total('milliseconds');
    }
    return Math.min(maxBackoffMs, intervalMs * 2 ** state.failures);
  };

  const didMoveHead = async (
    session: Session,
    ref: PullRequestRef,
    pullRequest: PullRequest,
  ): Promise<boolean> => {
    const repository = await openRepository(session.source.repoPath, context.session.git);
    if (!repository.ok) {
      logger.warn('github poll: clone unavailable', { error: repository.error });
      return false;
    }
    const remotes = await listRemoteUrls(repository.value);
    const remote = remotes.ok ? findMatchingRemote(remotes.value, ref) : undefined;
    if (remote === undefined) {
      logger.warn('github poll: no remote for the pull request', { ref });
      return false;
    }
    const synced = await syncPullRequestHead({
      repository: repository.value,
      remote: remote.name,
      pullRequest,
      refetch: async () => fetchPullRequest(context.clients, ref),
      logger,
    });
    if (!synced.ok) {
      logger.warn('github poll: new head not fetched', { failure: synced.error });
      return false;
    }
    if (synced.value.pullRequest !== pullRequest) {
      savePullRequest(context.session.db, ref, synced.value.pullRequest, Temporal.Now.instant());
    }
    return moveSessionHead(context.session, session, synced.value.headSha).ok;
  };

  const pollOnce = async (sessionId: string): Promise<number> => {
    const state = stateOf(sessionId);
    state.lastPolledAt = Temporal.Now.instant();
    const loaded = loadSession(context.session, sessionId);
    if (!loaded.ok) {
      return intervalMs;
    }
    const session = loaded.value;
    const { source } = session;
    if (source.kind !== 'github-pull-request') {
      return intervalMs;
    }
    const { host, owner, repo, number } = source;
    const ref: PullRequestRef = { host, owner, repo, number };
    const pulled = await context.clients.withClient(host, async (client) =>
      getPullRequest(client, ref, state.prEtag === undefined ? {} : { etag: state.prEtag }),
    );
    if (!pulled.ok) {
      logger.info('github poll: pull request unavailable', { kind: pulled.error.kind });
      return failed(state, pulled.error);
    }
    let headSha: string = session.headSha;
    if (pulled.value.kind === 'modified') {
      const pullRequest = pulled.value.value;
      savePullRequest(context.session.db, ref, pullRequest, Temporal.Now.instant());
      const stack = await context.clients.withClient(host, async (client) =>
        findPullRequestStack(client, pullRequest),
      );
      if (stack.ok) {
        state.stack = toStackView(host, stack.value);
      }
      const isNewHead = pullRequest.head.sha !== session.headSha;
      const hasHeadMoved = isNewHead && (await didMoveHead(session, ref, pullRequest));
      // A head that couldn't be fetched is asked for unconditionally next time, not 304'd past.
      state.prEtag = isNewHead && !hasHeadMoved ? undefined : pulled.value.etag;
      if (hasHeadMoved) {
        headSha = pullRequest.head.sha;
      }
      const stored = findStoredPullRequest(context.session.db, ref);
      if (stored.ok && stored.value !== undefined) {
        emit(updatedListeners, {
          sessionId,
          pullRequest: toPullRequestView(stored.value),
          stack: state.stack ?? { parents: [], children: [] },
          headMoved: hasHeadMoved,
        });
      }
    }
    if (state.ciSha !== headSha) {
      state.ciSha = headSha;
      delete state.ciEtags;
    }
    const ci = await context.clients.withClient(host, async (client) =>
      getCiStatus(
        client,
        { owner, repo, sha: headSha },
        state.ciEtags === undefined ? {} : { etags: state.ciEtags },
      ),
    );
    if (!ci.ok) {
      logger.info('github poll: CI status unavailable', { kind: ci.error.kind });
      return failed(state, ci.error);
    }
    if (ci.value.kind === 'modified') {
      state.ciEtags = ci.value.etags;
      state.ci = toCiStatusView(ci.value.value);
      emit(ciListeners, { sessionId, ci: state.ci });
    }
    state.failures = 0;
    return intervalMs;
  };

  const pollShared = async (sessionId: string): Promise<number> => {
    const running = inFlight.get(sessionId);
    if (running !== undefined) {
      return running;
    }
    const started = (async (): Promise<number> => {
      try {
        return await pollOnce(sessionId);
      } catch (error: unknown) {
        logger.error('github poll failed', { error });
        return intervalMs;
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
          schedule(
            Temporal.Duration.from({ milliseconds: isForeground ? next : next * backgroundFactor }),
          );
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
      const last = stateOf(watched).lastPolledAt;
      const interval = Temporal.Duration.from({ milliseconds: intervalMs });
      const remaining =
        last === undefined
          ? new Temporal.Duration()
          : interval.subtract(last.until(Temporal.Now.instant()));
      schedule(remaining.sign < 0 ? new Temporal.Duration() : remaining);
    },
    snapshot: (sessionId): ReturnType<PullRequestPoller['snapshot']> => {
      const state = states.get(sessionId);
      return {
        ...(state?.ci !== undefined && { ci: state.ci }),
        ...(state?.stack !== undefined && { stack: state.stack }),
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
    },
  };
}
