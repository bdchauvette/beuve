import type { RepositoryName } from '#internal/github/get-repository.ts';
import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';
import { savePullRequest } from '#internal/github/save-pull-request.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import { promoteSession } from '#internal/session/promote-session.ts';
import type { Session } from '#internal/session/session.ts';

import { fetchPullRequest } from './fetch-pull-request.ts';
import type { GithubContext } from './github-context.ts';
import { moveSessionHead } from './move-session-head.ts';
import type { SessionRemote } from './open-session-remote.ts';
import { syncPullRequestHead } from './sync-pull-request-head.ts';

/** What became of a remote-branch session whose branch has an open pull request. */
export type BranchPromotion =
  | { readonly kind: 'promoted'; readonly session: Session }
  /** Another session of the same clone already reviews the pull request; nothing changed. */
  | { readonly kind: 'already-reviewed'; readonly sessionId: string }
  | { readonly kind: 'failed' };

/** The remote-branch session, its pull request as GitHub listed it, and where to fetch it. */
export interface PromotionInput {
  readonly session: Session;
  readonly pullRequest: PullRequest;
  /** The pull request's base repository: the branch's own, or an upstream of its fork. */
  readonly base: RepositoryName;
  /** The clone's remote for `base`. */
  readonly remote: SessionRemote;
}

/**
 * Promotes a remote-branch session to its pull request's session in place (ADR 0112): fetches
 * and verifies the pull request as `github:open-pr` does, stores its metadata, rewrites the
 * session row with `promoteSession` (same id, so the review carries over; a fork's branch becomes
 * the session of the upstream's pull request) and moves the head to the fetched one. A pull request session already reviewing it in the same clone wins: the branch
 * session stays as it is and the answer names the other session.
 */
export async function promoteBranchSession(
  context: GithubContext,
  { session, pullRequest, base, remote }: PromotionInput,
  signal: AbortSignal,
): Promise<BranchPromotion> {
  const { db, logger } = context.session;
  const { source } = session;
  if (source.kind !== 'remote-branch') {
    return { kind: 'failed' };
  }
  const ref: PullRequestRef = {
    host: source.host,
    owner: base.owner,
    repo: base.repo,
    number: pullRequest.number,
  };
  const existing = findSessionBySource(db, {
    kind: 'github-pull-request',
    repoPath: source.repoPath,
    baseRef: '',
    ...ref,
  });
  if (existing.ok && existing.value !== undefined) {
    return { kind: 'already-reviewed', sessionId: existing.value.id };
  }
  const synced = await syncPullRequestHead({
    repository: remote.repository,
    remote: remote.remote,
    pullRequest,
    refetch: async () => {
      return fetchPullRequest(context.clients, ref, signal);
    },
    logger,
    signal,
  });
  if (!synced.ok) {
    logger.warn('github poll: pull request of the branch not fetched', { failure: synced.error });
    return { kind: 'failed' };
  }
  savePullRequest(db, ref, synced.value.pullRequest);
  const promoted = promoteSession(db, {
    session,
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    baseRef: synced.value.baseRef,
  });
  if (!promoted.ok) {
    if (promoted.error.kind === 'duplicate-session') {
      const winner = findSessionBySource(db, promoted.error.source);
      if (winner.ok && winner.value !== undefined) {
        return { kind: 'already-reviewed', sessionId: winner.value.id };
      }
    }
    logger.warn('github poll: branch session not promoted', { error: promoted.error });
    return { kind: 'failed' };
  }
  logger.info('github: branch session promoted to its pull request', {
    sessionId: session.id,
    number: ref.number,
  });
  const moved = moveSessionHead(context.session, promoted.value, synced.value.headSha);
  if (moved.ok) {
    return { kind: 'promoted', session: moved.value };
  }
  return { kind: 'promoted', session: promoted.value };
}
