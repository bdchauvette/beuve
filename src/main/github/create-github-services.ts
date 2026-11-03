import type {
  CiStatusChangedView,
  GithubAuthStatusRequest,
  GithubAuthStatusView,
  GithubFailureView,
  GithubReviewPreviewView,
  IpcResult,
  OpenGithubLinkRequest,
  OpenedView,
  OpenPullRequestRequest,
  OpenPullRequestResponse,
  PostGithubReviewRequest,
  PostGithubReviewResponse,
  PullRequestBadgeView,
  PullRequestSessionView,
  PullRequestTimelineView,
  PullRequestUpdatedView,
  SessionSourceView,
} from '#contract/ipc-contract.ts';
import { findPullRequestStack } from '#internal/github/find-pull-request-stack.ts';
import { findStoredPullRequest } from '#internal/github/find-stored-pull-request.ts';
import { getPullRequestTimeline } from '#internal/github/get-pull-request-timeline.ts';
import { normalizeHostname } from '#x/net/normalize-hostname.ts';
import type { StoredPullRequest } from '#internal/github/stored-pull-request.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { Session } from '#internal/session/session.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { loadSession } from '../sessions/load-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { ClonePathSettings } from './create-clone-path-settings.ts';
import type { GithubClients } from './create-github-clients.ts';
import { createPullRequestPoller } from './create-pull-request-poller.ts';
import { describeAuthStatus } from './describe-auth-status.ts';
import { failureFromGithubError } from './failure-from-github-error.ts';
import type { GithubContext } from './github-context.ts';
import { isAllowedGithubLink } from './is-allowed-github-link.ts';
import { openPullRequest } from './open-pull-request.ts';
import { postGithubReview } from './post-github-review.ts';
import { prepareGithubReview } from './prepare-github-review.ts';
import { pullRequestViewFrom } from './pull-request-view-from.ts';
import { stackViewFrom } from './stack-view-from.ts';

/** GitHub pull request sessions as the renderer reaches them (ADR 0037–0040). */
export interface GithubServices {
  readonly authStatus: (
    request: GithubAuthStatusRequest,
  ) => Promise<IpcResult<GithubAuthStatusView>>;
  readonly openPullRequest: (
    request: OpenPullRequestRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<OpenPullRequestResponse>>;
  readonly getPullRequest: (sessionId: string) => Promise<IpcResult<PullRequestSessionView>>;
  /** The pull request's commits, reviews and comments, oldest first (ADR 0110). */
  readonly getTimeline: (
    sessionId: string,
  ) => Promise<IpcResult<PullRequestTimelineView | GithubFailureView>>;
  readonly previewReview: (
    request: PostGithubReviewRequest,
  ) => Promise<IpcResult<GithubReviewPreviewView | GithubFailureView>>;
  readonly postReview: (
    request: PostGithubReviewRequest,
  ) => Promise<IpcResult<PostGithubReviewResponse>>;
  readonly openLink: (request: OpenGithubLinkRequest) => Promise<IpcResult<OpenedView>>;
  /** The stored title, state and base branch of a pull request session, for the session list. */
  readonly badgeFor: (source: SessionSourceView) => PullRequestBadgeView | undefined;
  /** The PR body as review intent (ADR 0022's `intent`), for pull request sessions. */
  readonly intentFor: (sessionId: string) => string | undefined;
  /** Polls this session while it is the one the reviewer has open; `undefined` stops polling. */
  readonly watch: (sessionId: string | undefined) => void;
  /** One poll now (tests, and a window regaining focus). */
  readonly pollNow: (sessionId: string) => Promise<void>;
  readonly setForeground: (isForeground: boolean) => void;
  readonly onPullRequestUpdated: (listener: (event: PullRequestUpdatedView) => void) => () => void;
  readonly onCiStatus: (listener: (event: CiStatusChangedView) => void) => () => void;
  readonly dispose: () => void;
}

export interface GithubServicesOptions {
  readonly context: SessionContext;
  readonly clients: GithubClients;
  readonly clonePaths: ClonePathSettings;
  readonly ura: Pick<UraServices, 'compileArtifact' | 'listPostings' | 'recordPostings'>;
  /** Opens an allow-listed URL in the system browser; absent outside Electron. */
  readonly openExternal?: (url: string) => Promise<void>;
  readonly polling?: { readonly interval?: Temporal.Duration; readonly scheduled?: boolean };
  /** The session the reviewer has open, for `github:auth-status` without a host. */
  readonly openSessionId: () => string | undefined;
}

/** Composes the auth and github domains with sessions, git and the URA dock. */
export function createGithubServices(options: GithubServicesOptions): GithubServices {
  const github: GithubContext = {
    session: options.context,
    clients: options.clients,
    clonePaths: options.clonePaths,
  };
  const { db, logger } = options.context;
  const poller = createPullRequestPoller({
    context: github,
    ...options.polling,
  });

  /** Sessions with a post in flight: a second overlapping post would create a second review. */
  const posting = new Set<string>();

  const storedFor = (
    source: Session['source'] | SessionSourceView,
  ): StoredPullRequest | undefined => {
    if (source.kind !== 'github-pull-request') {
      return undefined;
    }
    const { host, owner, repo, number } = source;
    const stored = findStoredPullRequest(db, { host, owner, repo, number });
    if (!stored.ok) {
      logger.warn('stored pull request is corrupt', { error: stored.error });
      return undefined;
    }
    return stored.value;
  };

  const storedForSession = (sessionId: string): StoredPullRequest | undefined => {
    const loaded = loadSession(options.context, sessionId);
    if (!loaded.ok) {
      return undefined;
    }
    return storedFor(loaded.value.source);
  };

  const knownHosts = (): Set<string> => {
    const hosts = new Set(['github.com']);
    const listed = listSessions(db);
    if (!listed.ok) {
      return hosts;
    }
    for (const session of listed.value) {
      if (session.source.kind === 'github-pull-request') {
        hosts.add(session.source.host);
      }
    }
    return hosts;
  };

  const defaultHost = (): string => {
    const sessionId = options.openSessionId();
    if (sessionId === undefined) {
      return 'github.com';
    }
    const session = loadSession(options.context, sessionId);
    if (session.ok && session.value.source.kind === 'github-pull-request') {
      return session.value.source.host;
    }
    return 'github.com';
  };

  return {
    authStatus: async ({ host }): Promise<IpcResult<GithubAuthStatusView>> => {
      let target: string | undefined;
      if (host === undefined) {
        target = defaultHost();
      } else {
        target = normalizeHostname(host);
      }
      if (target === undefined) {
        return err({ code: 'invalid-request', message: `not a GitHub hostname: ${host ?? ''}` });
      }
      const described = await options.clients.credentials.describe({ host: target });
      return ok(describeAuthStatus(target, described));
    },

    openPullRequest: async (request, call = {}): Promise<IpcResult<OpenPullRequestResponse>> => {
      const opened = await openPullRequest(github, request, {
        onOpened: ({ session, pullRequest }) => {
          poller.watch(session.id);
          void (async (): Promise<void> => {
            const stack = await options.clients.withClient(
              hostOf(session.source),
              async (client) => {
                // eslint-disable-next-line local/forward-abort-signal -- the stack lookup outlives the open request.
                return findPullRequestStack(client, pullRequest);
              },
            );
            if (stack.ok && session.source.kind === 'github-pull-request') {
              poller.rememberStack(session.id, stackViewFrom(session.source.host, stack.value));
            }
          })();
        },
        signal: call.signal,
      });
      return ok(opened);
    },

    getPullRequest: async (sessionId): Promise<IpcResult<PullRequestSessionView>> => {
      const loaded = loadSession(options.context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const stored = storedFor(loaded.value.source);
      if (stored === undefined) {
        if (loaded.value.source.kind !== 'github-pull-request') {
          return err({ code: 'refused', message: 'not a pull request session' });
        }
        await poller.pollNow(sessionId);
      }
      const current = stored ?? storedFor(loaded.value.source);
      if (current === undefined) {
        return err({
          code: 'not-found',
          message: 'GitHub has not answered for this pull request yet',
        });
      }
      poller.watch(sessionId);
      const snapshot = poller.snapshot(sessionId);
      return ok({
        sessionId,
        pullRequest: pullRequestViewFrom(current),
        stack: snapshot.stack ?? { parents: [], children: [] },
        ...(snapshot.ci !== undefined && { ci: snapshot.ci }),
        ...(snapshot.attention !== undefined && { attention: snapshot.attention }),
      });
    },

    getTimeline: async (
      sessionId,
    ): Promise<IpcResult<PullRequestTimelineView | GithubFailureView>> => {
      const loaded = loadSession(options.context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const { source } = loaded.value;
      if (source.kind !== 'github-pull-request') {
        return err({ code: 'refused', message: 'not a pull request session' });
      }
      const { host, owner, repo, number } = source;
      const timeline = await options.clients.withClient(host, async (client) => {
        return getPullRequestTimeline(client, { owner, repo, number });
      });
      if (!timeline.ok) {
        return ok(failureFromGithubError(timeline.error, `${owner}/${repo}#${String(number)}`));
      }
      return ok({ kind: 'timeline', ...timeline.value });
    },

    previewReview: async (
      request,
    ): Promise<IpcResult<GithubReviewPreviewView | GithubFailureView>> => {
      const prepared = await prepareGithubReview(github, options.ura, request);
      if (!prepared.ok) {
        if ('code' in prepared.error) {
          return err(prepared.error);
        }
        return ok(prepared.error);
      }
      return ok(prepared.value.preview);
    },

    postReview: async (request): Promise<IpcResult<PostGithubReviewResponse>> => {
      if (posting.has(request.sessionId)) {
        return err({
          code: 'refused',
          message: 'A review is already being posted for this pull request.',
        });
      }
      posting.add(request.sessionId);
      try {
        const posted = await postGithubReview(github, options.ura, request);
        if (
          posted.ok &&
          posted.value.kind === 'failed' &&
          posted.value.failure === 'stale-commit'
        ) {
          void poller.pollNow(request.sessionId);
        }
        return posted;
      } finally {
        posting.delete(request.sessionId);
      }
    },

    openLink: async ({ url }): Promise<IpcResult<OpenedView>> => {
      if (!isAllowedGithubLink(url, knownHosts())) {
        return err({ code: 'refused', message: 'Only https links to GitHub open from beuve.' });
      }
      if (options.openExternal === undefined) {
        return err({ code: 'not-wired', message: 'no browser outside Electron' });
      }
      await options.openExternal(url);
      return ok({ opened: true });
    },

    badgeFor: (source): PullRequestBadgeView | undefined => {
      const stored = storedFor(source);
      if (stored === undefined) {
        return undefined;
      }
      return {
        title: stored.title,
        state: stored.state,
        isDraft: stored.isDraft,
        baseBranch: stored.baseBranch,
      };
    },

    intentFor: (sessionId): string | undefined => {
      const stored = storedForSession(sessionId);
      if (stored === undefined) {
        return undefined;
      }
      return `${stored.title}\n\n${stored.body}`.trim();
    },

    watch: poller.watch,
    pollNow: poller.pollNow,
    setForeground: poller.setForeground,
    onPullRequestUpdated: poller.onUpdated,
    onCiStatus: poller.onCiStatus,
    dispose: poller.dispose,
  };
}

/** The GitHub host a session's pull request lives on; github.com for any other session. */
function hostOf(source: Session['source']): string {
  if (source.kind === 'github-pull-request') {
    return source.host;
  }
  return 'github.com';
}
