import type {
  CiStatusChangedView,
  GithubAuthStatusRequest,
  GithubAuthStatusView,
  GithubFailureView,
  GithubReviewPreviewView,
  IpcResult,
  OpenGithubLinkRequest,
  OpenPullRequestRequest,
  OpenPullRequestResponse,
  PostGithubReviewRequest,
  PostGithubReviewResponse,
  PullRequestBadgeView,
  PullRequestSessionView,
  PullRequestUpdatedView,
  SessionSourceView,
} from '#contract/ipc-contract.ts';
import { findPullRequestStack } from '#internal/github/find-pull-request-stack.ts';
import { findStoredPullRequest } from '#internal/github/find-stored-pull-request.ts';
import { normalizeGithubHost } from '#internal/github/normalize-github-host.ts';
import type { StoredPullRequest } from '#internal/github/stored-pull-request.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { Session } from '#internal/session/session.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { loadSession } from '../sessions/load-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { ClonePathSettings } from './create-clone-path-settings.ts';
import type { GithubClients } from './create-github-clients.ts';
import { createPullRequestPoller } from './create-pull-request-poller.ts';
import { describeAuthStatus } from './describe-auth-status.ts';
import type { GithubContext } from './github-context.ts';
import { isAllowedGithubLink } from './is-allowed-github-link.ts';
import { openPullRequest } from './open-pull-request.ts';
import { postGithubReview } from './post-github-review.ts';
import { prepareGithubReview } from './prepare-github-review.ts';
import { toPullRequestView } from './to-pull-request-view.ts';
import { toStackView } from './to-stack-view.ts';

/** The identifying metadata of a pull request, as `beuve_read_human_review` reports it. */
export interface PullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly author: string;
}

/** GitHub pull request sessions as the renderer reaches them (ADR 0037–0040). */
export interface GithubServices {
  readonly authStatus: (
    request: GithubAuthStatusRequest,
  ) => Promise<IpcResult<GithubAuthStatusView>>;
  readonly openPullRequest: (
    request: OpenPullRequestRequest,
  ) => Promise<IpcResult<OpenPullRequestResponse>>;
  readonly getPullRequest: (sessionId: string) => Promise<IpcResult<PullRequestSessionView>>;
  readonly previewReview: (
    request: PostGithubReviewRequest,
  ) => Promise<IpcResult<GithubReviewPreviewView | GithubFailureView>>;
  readonly postReview: (
    request: PostGithubReviewRequest,
  ) => Promise<IpcResult<PostGithubReviewResponse>>;
  readonly openLink: (
    request: OpenGithubLinkRequest,
  ) => Promise<IpcResult<{ readonly opened: true }>>;
  /** The stored title, state and base branch of a pull request session, for the session list. */
  readonly badgeFor: (source: SessionSourceView) => PullRequestBadgeView | undefined;
  /** Stored number, title, URL, state and author of a pull request session, for agents (ADR 0041). */
  readonly summaryFor: (sessionId: string) => PullRequestSummary | undefined;
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
  readonly polling?: { readonly intervalMs?: number; readonly scheduled?: boolean };
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

  const knownHosts = (): Set<string> => {
    const hosts = new Set(['github.com']);
    const listed = listSessions(db);
    const sessions = listed.ok ? listed.value : [];
    for (const session of sessions) {
      if (session.source.kind === 'github-pull-request') {
        hosts.add(session.source.host);
      }
    }
    return hosts;
  };

  const defaultHost = (): string => {
    const sessionId = options.openSessionId();
    const session = sessionId === undefined ? undefined : loadSession(options.context, sessionId);
    return session?.ok === true && session.value.source.kind === 'github-pull-request'
      ? session.value.source.host
      : 'github.com';
  };

  return {
    authStatus: async ({ host }): Promise<IpcResult<GithubAuthStatusView>> => {
      const target = host === undefined ? defaultHost() : normalizeGithubHost(host);
      if (target === undefined) {
        return err({ code: 'invalid-request', message: `not a GitHub hostname: ${host ?? ''}` });
      }
      const described = await options.clients.credentials.describe({ host: target });
      return ok(describeAuthStatus(target, described));
    },

    openPullRequest: async (request): Promise<IpcResult<OpenPullRequestResponse>> => {
      const opened = await openPullRequest(github, request, ({ session, pullRequest }) => {
        poller.watch(session.id);
        void (async (): Promise<void> => {
          const stack = await options.clients.withClient(
            session.source.kind === 'github-pull-request' ? session.source.host : 'github.com',
            async (client) => findPullRequestStack(client, pullRequest),
          );
          if (stack.ok && session.source.kind === 'github-pull-request') {
            poller.rememberStack(session.id, toStackView(session.source.host, stack.value));
          }
        })();
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
        pullRequest: toPullRequestView(current),
        stack: snapshot.stack ?? { parents: [], children: [] },
        ...(snapshot.ci !== undefined && { ci: snapshot.ci }),
      });
    },

    previewReview: async (
      request,
    ): Promise<IpcResult<GithubReviewPreviewView | GithubFailureView>> => {
      const prepared = await prepareGithubReview(github, options.ura, request);
      if (!prepared.ok) {
        return 'code' in prepared.error ? err(prepared.error) : ok(prepared.error);
      }
      return ok(prepared.value.preview);
    },

    postReview: async (request): Promise<IpcResult<PostGithubReviewResponse>> => {
      const posted = await postGithubReview(github, options.ura, request);
      if (posted.ok && posted.value.kind === 'failed' && posted.value.failure === 'stale-commit') {
        void poller.pollNow(request.sessionId);
      }
      return posted;
    },

    openLink: async ({ url }): Promise<IpcResult<{ opened: true }>> => {
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
      return stored === undefined
        ? undefined
        : {
            title: stored.title,
            state: stored.state,
            isDraft: stored.isDraft,
            baseBranch: stored.baseBranch,
          };
    },

    summaryFor: (sessionId): PullRequestSummary | undefined => {
      const loaded = loadSession(options.context, sessionId);
      const stored = loaded.ok ? storedFor(loaded.value.source) : undefined;
      return stored === undefined
        ? undefined
        : {
            number: stored.ref.number,
            title: stored.title,
            url: stored.htmlUrl,
            state: stored.state,
            author: stored.author,
          };
    },

    intentFor: (sessionId): string | undefined => {
      const loaded = loadSession(options.context, sessionId);
      const stored = loaded.ok ? storedFor(loaded.value.source) : undefined;
      return stored === undefined ? undefined : `${stored.title}\n\n${stored.body}`.trim();
    },

    watch: poller.watch,
    pollNow: poller.pollNow,
    setForeground: poller.setForeground,
    onPullRequestUpdated: poller.onUpdated,
    onCiStatus: poller.onCiStatus,
    dispose: poller.dispose,
  };
}
