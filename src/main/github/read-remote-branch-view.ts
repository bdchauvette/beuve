import type { RemoteBranchView } from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readCommitMessage } from '#internal/git/read-commit-message.ts';
import type { BranchRef } from '#internal/github/branch-ref.ts';
import { findStoredBranch } from '#internal/github/find-stored-branch.ts';
import type { BranchPullRequestRef } from '#internal/github/stored-branch.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import type { Session } from '#internal/session/session.ts';

import { openSessionRepository } from '../sessions/open-session-repository.ts';

import { agentSessionUrlFrom } from './agent-session-url-from.ts';
import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';

/**
 * What the UI shows of a remote-branch session's branch (ADR 0112): the stored metadata, the
 * branch's pull request when the session couldn't become its session (the session already
 * reviewing it, or that the clone has no remote for its repository), and the head commit's
 * `Claude-Session` link, read on the warm object reader. `undefined` for other sessions and for
 * a branch beuve stored nothing about.
 */
export async function readRemoteBranchView(
  context: GithubContext,
  session: Session,
  signal?: AbortSignal,
): Promise<RemoteBranchView | undefined> {
  const { source } = session;
  if (source.kind !== 'remote-branch') {
    return undefined;
  }
  const ref: BranchRef = {
    host: source.host,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch,
  };
  const { db, logger } = context.session;
  const stored = findStoredBranch(db, ref);
  if (!stored.ok) {
    logger.warn('stored branch is corrupt', { error: stored.error });
    return undefined;
  }
  if (stored.value === undefined) {
    return undefined;
  }
  const { defaultBranch, htmlUrl, state, pullRequest } = stored.value;
  const view: RemoteBranchView = {
    ...ref,
    defaultBranch,
    headSha: session.headSha,
    state,
    htmlUrl,
  };
  const opened = await openSessionRepository(context.session, source.repoPath, signal);
  let repository: GitRepository | undefined;
  if (opened.ok) {
    repository = opened.value;
  }
  const agentSessionUrl = await readAgentSessionUrl(repository, session, signal);
  let pullRequestView: RemoteBranchView['pullRequest'];
  if (pullRequest !== undefined) {
    pullRequestView = await pullRequestOf(context, {
      host: ref.host,
      repoPath: source.repoPath,
      repository,
      pullRequest,
    });
  }
  return {
    ...view,
    ...(pullRequestView !== undefined && { pullRequest: pullRequestView }),
    ...(agentSessionUrl !== undefined && { agentSessionUrl }),
  };
}

/** The branch's pull request, the clone it would be reviewed in, and that clone if it opened. */
interface PullRequestLookup {
  readonly host: string;
  readonly repoPath: string;
  readonly repository: GitRepository | undefined;
  readonly pullRequest: BranchPullRequestRef;
}

async function pullRequestOf(
  context: GithubContext,
  { host, repoPath, repository, pullRequest }: PullRequestLookup,
): Promise<NonNullable<RemoteBranchView['pullRequest']>> {
  const { owner, repo, number } = pullRequest;
  const view = {
    owner,
    repo,
    number,
    htmlUrl: `https://${host}/${owner}/${repo}/pull/${String(number)}`,
  };
  const reviewing = findSessionBySource(context.session.db, {
    kind: 'github-pull-request',
    repoPath,
    baseRef: '',
    host,
    owner,
    repo,
    number,
  });
  if (reviewing.ok && reviewing.value !== undefined) {
    return { ...view, sessionId: reviewing.value.id };
  }
  if (repository === undefined) {
    return view;
  }
  const remotes = await listRemoteUrls(repository);
  const isMissing =
    remotes.ok && findMatchingRemote(remotes.value, { host, owner, repo }) === undefined;
  return { ...view, ...(isMissing && { needsRemote: true }) };
}

async function readAgentSessionUrl(
  repository: GitRepository | undefined,
  session: Session,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (repository === undefined) {
    return undefined;
  }
  const message = await readCommitMessage(repository, session.headSha, { signal });
  if (!message.ok || message.value === undefined) {
    return undefined;
  }
  return agentSessionUrlFrom(message.value);
}
