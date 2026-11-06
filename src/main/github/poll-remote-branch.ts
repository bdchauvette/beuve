import type { RemoteBranchUpdatedView } from '#contract/ipc-contract.ts';
import type { AuthError } from '#internal/auth/auth-error.ts';
import type { BranchRef, RemoteBranchTip } from '#internal/github/branch-ref.ts';
import { findStoredBranch } from '#internal/github/find-stored-branch.ts';
import { getBranch } from '#internal/github/get-branch.ts';
import type { GithubError } from '#internal/github/github-error.ts';
import { saveStoredBranch } from '#internal/github/save-stored-branch.ts';
import type { BranchPullRequestRef, StoredBranch } from '#internal/github/stored-branch.ts';
import type { Session } from '#internal/session/session.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';
import { lookUpBranchPullRequest } from './look-up-branch-pull-request.ts';
import type { BranchPullRequest, PullRequestAnswers } from './look-up-branch-pull-request.ts';
import { moveSessionHead } from './move-session-head.ts';
import { openSessionRemote } from './open-session-remote.ts';
import { promoteBranchSession } from './promote-branch-session.ts';
import { readRemoteBranchView } from './read-remote-branch-view.ts';
import { syncRemoteBranch } from './sync-remote-branch.ts';

/** What one remote-branch session's polls remember between polls (ADR 0112). */
export interface BranchPollState {
  branchEtag?: string | undefined;
  /** What each repository asked for the branch's pull request last answered, with its ETag. */
  readonly pulls: PullRequestAnswers;
  /** The head as the last poll left it; another writer moving it drops `branchEtag`. */
  headSeen?: string | undefined;
  /** Polls so far, for the pull request check's slower cadence. */
  polls: number;
}

/**
 * What a poll did: `polled` (the session stays a branch), `gone` (the branch is not on the remote:
 * stop polling until the session is opened again), `promoted` (it is now a pull request session)
 * or `failed` (back off). `event` is set when something the UI shows changed.
 */
export type BranchPollOutcome =
  | {
      readonly kind: 'polled' | 'gone' | 'promoted';
      readonly event: RemoteBranchUpdatedView | undefined;
    }
  | { readonly kind: 'failed'; readonly error: GithubError<AuthError> };

/** The session to poll, the state its polls keep, and the poller's lifetime. */
export interface BranchPoll {
  readonly session: Session;
  readonly state: BranchPollState;
  readonly signal: AbortSignal;
}

/** Without a branch change, the pull request list is asked every this many polls. */
const pullRequestCheckEvery = 5;

/**
 * One poll of a remote-branch session (ADR 0112): `GET …/branches/{branch}` with its ETag; a new
 * tip is fetched, verified and stored with `advanceHead`; a 404 marks the branch `gone` and keeps
 * the last head. On the first poll, whenever the branch changed and otherwise every fifth poll,
 * the open pull request for the branch is looked up (conditionally too) in its repository and,
 * for a fork, the upstreams; when there is one, the session is promoted to it in place. A pull
 * request found but not promoted to (reviewed elsewhere, or no remote for its repository) is
 * tried again on every poll from the remembered answers, so adding the remote promotes it.
 */
export async function pollRemoteBranch(
  context: GithubContext,
  { session, state, signal }: BranchPoll,
): Promise<BranchPollOutcome> {
  const { source } = session;
  if (source.kind !== 'remote-branch') {
    return { kind: 'polled', event: undefined };
  }
  const { db, logger } = context.session;
  const ref: BranchRef = {
    host: source.host,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch,
  };
  const stored = findStoredBranch(db, ref);
  if (!stored.ok || stored.value === undefined) {
    logger.warn('github poll: no stored branch', { ref });
    return { kind: 'polled', event: undefined };
  }
  if (state.headSeen !== undefined && state.headSeen !== session.headSha) {
    state.branchEtag = undefined;
  }
  state.polls += 1;
  const got = await context.clients.withClient(ref.host, async (client) => {
    return getBranch(client, ref, {
      ...(state.branchEtag !== undefined && { etag: state.branchEtag }),
      signal,
    });
  });
  if (!got.ok && got.error.kind === 'not-found') {
    return markGone(context, { session, state, signal }, stored.value);
  }
  if (!got.ok) {
    return { kind: 'failed', error: got.error };
  }
  let current: Session = session;
  let isHeadMoved = false;
  const isAnswered = got.value.kind === 'modified';
  if (got.value.kind === 'modified') {
    const moved = await moveBranchHead(context, { session, state, signal }, got.value.value);
    state.branchEtag = got.value.etag;
    if (moved === undefined && got.value.value.sha !== session.headSha) {
      state.branchEtag = undefined;
    }
    current = moved ?? session;
    isHeadMoved = moved !== undefined;
  }
  state.headSeen = current.headSha;
  let record: StoredBranch = { ...stored.value, state: 'present', headSha: current.headSha };
  const isPullCheckDue = isAnswered || state.polls % pullRequestCheckEvery === 1;
  if (isPullCheckDue || stored.value.pullRequest !== undefined) {
    const lookup = await lookUpBranchPullRequest(context, {
      ref,
      parent: stored.value.parent,
      source: stored.value.source,
      answers: state.pulls,
      isOffline: !isPullCheckDue,
      signal,
    });
    if (lookup.kind === 'known' && lookup.found !== undefined) {
      const promoted = await promote(context, { session: current, state, signal }, lookup.found);
      if (promoted.kind === 'promoted') {
        saveStoredBranch(db, { ...record, pullRequest: refOf(lookup.found) });
        return {
          kind: 'promoted',
          event: await eventFor(context, { session: current, isHeadMoved, isPromoted: true }),
        };
      }
      record = { ...record, pullRequest: promoted.pullRequest };
    } else if (lookup.kind === 'known') {
      record = { ...record, pullRequest: undefined };
    }
  }
  const isChanged =
    isHeadMoved ||
    stored.value.state === 'gone' ||
    !isSamePullRequest(record.pullRequest, stored.value.pullRequest);
  if (!isChanged) {
    return { kind: 'polled', event: undefined };
  }
  saveStoredBranch(db, record);
  return {
    kind: 'polled',
    event: await eventFor(context, { session: current, isHeadMoved, isPromoted: false }),
  };
}

async function markGone(
  context: GithubContext,
  { session, state }: BranchPoll,
  stored: StoredBranch,
): Promise<BranchPollOutcome> {
  state.branchEtag = undefined;
  state.pulls.clear();
  if (stored.state === 'gone') {
    return { kind: 'gone', event: undefined };
  }
  context.session.logger.info('github poll: the followed branch is gone', {
    sessionId: session.id,
  });
  saveStoredBranch(context.session.db, { ...stored, state: 'gone' });
  return {
    kind: 'gone',
    event: await eventFor(context, { session, isHeadMoved: false, isPromoted: false }),
  };
}

/** Fetches and verifies a new tip and stores it as the session's head; `undefined` if it couldn't. */
async function moveBranchHead(
  context: GithubContext,
  { session, signal }: BranchPoll,
  tip: RemoteBranchTip,
): Promise<Session | undefined> {
  const { source } = session;
  if (tip.sha === session.headSha || source.kind !== 'remote-branch') {
    return undefined;
  }
  const remote = await openSessionRemote(context, { session, repository: source }, signal);
  if (remote === undefined) {
    return undefined;
  }
  const { db, logger } = context.session;
  const ref: BranchRef = {
    host: source.host,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch,
  };
  const stored = findStoredBranch(db, ref);
  if (!stored.ok || stored.value === undefined) {
    return undefined;
  }
  const synced = await syncRemoteBranch({
    repository: remote.repository,
    remote: remote.remote,
    ref,
    defaultBranch: stored.value.defaultBranch,
    tip,
    refetch: async () => {
      const again = await context.clients.withClient(ref.host, async (client) => {
        return getBranch(client, ref, { signal });
      });
      if (again.ok && again.value.kind === 'modified') {
        return ok(again.value.value);
      }
      return err(githubFailure('fetch-failed', `${ref.branch} could not be read again`));
    },
    logger,
    signal,
  });
  if (!synced.ok) {
    logger.warn('github poll: new branch head not fetched', { failure: synced.error });
    return undefined;
  }
  const moved = moveSessionHead(context.session, session, synced.value.headSha);
  if (moved.ok && moved.value.headSha !== session.headSha) {
    return moved.value;
  }
  return undefined;
}

/** What a promotion attempt leaves on the stored branch: the pull request it couldn't become. */
type PromotionResult =
  | { readonly kind: 'promoted' }
  | { readonly kind: 'kept'; readonly pullRequest: BranchPullRequestRef | undefined };

/**
 * Promotes the session to `found` through the clone's remote for the pull request's repository
 * (an upstream's, for a fork's pull request). Without that remote, or while another session
 * reviews it, the session stays a branch and keeps the pull request; a failed fetch keeps none,
 * so the next due check tries again.
 */
async function promote(
  context: GithubContext,
  { session, signal }: BranchPoll,
  found: BranchPullRequest,
): Promise<PromotionResult> {
  const { source } = session;
  if (source.kind !== 'remote-branch') {
    return { kind: 'kept', pullRequest: undefined };
  }
  const remote = await openSessionRemote(
    context,
    { session, repository: { host: source.host, ...found.base } },
    signal,
  );
  if (remote === undefined) {
    return { kind: 'kept', pullRequest: refOf(found) };
  }
  const promoted = await promoteBranchSession(
    context,
    { session, pullRequest: found.pullRequest, base: found.base, remote },
    signal,
  );
  switch (promoted.kind) {
    case 'promoted': {
      return { kind: 'promoted' };
    }
    case 'already-reviewed': {
      return { kind: 'kept', pullRequest: refOf(found) };
    }
    case 'failed': {
      return { kind: 'kept', pullRequest: undefined };
    }
  }
}

function refOf({ base, pullRequest }: BranchPullRequest): BranchPullRequestRef {
  return { owner: base.owner, repo: base.repo, number: pullRequest.number };
}

function isSamePullRequest(
  a: BranchPullRequestRef | undefined,
  b: BranchPullRequestRef | undefined,
): boolean {
  return (
    a?.number === b?.number &&
    a?.owner.toLowerCase() === b?.owner.toLowerCase() &&
    a?.repo.toLowerCase() === b?.repo.toLowerCase()
  );
}

/** The session the event is about, and what happened to it. */
interface EventInput {
  readonly session: Session;
  readonly isHeadMoved: boolean;
  readonly isPromoted: boolean;
}

async function eventFor(
  context: GithubContext,
  { session, isHeadMoved, isPromoted }: EventInput,
): Promise<RemoteBranchUpdatedView | undefined> {
  const branch = await readRemoteBranchView(context, session);
  if (branch === undefined) {
    return undefined;
  }
  return { sessionId: session.id, branch, headMoved: isHeadMoved, promoted: isPromoted };
}
