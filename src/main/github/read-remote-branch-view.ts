import type { RemoteBranchView } from '#contract/ipc-contract.ts';
import { readCommitMessage } from '#internal/git/read-commit-message.ts';
import type { BranchRef } from '#internal/github/branch-ref.ts';
import { findStoredBranch } from '#internal/github/find-stored-branch.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import type { Session } from '#internal/session/session.ts';

import { openSessionRepository } from '../sessions/open-session-repository.ts';

import { agentSessionUrlFrom } from './agent-session-url-from.ts';
import type { GithubContext } from './github-context.ts';

/**
 * What the UI shows of a remote-branch session's branch (ADR 0112): the stored metadata, the
 * session already reviewing the branch's pull request when there is one, and the head commit's
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
  const { defaultBranch, htmlUrl, state, pullNumber } = stored.value;
  const view: RemoteBranchView = {
    ...ref,
    defaultBranch,
    headSha: session.headSha,
    state,
    htmlUrl,
  };
  const agentSessionUrl = await readAgentSessionUrl(context, session, signal);
  return {
    ...view,
    ...(pullNumber !== undefined && {
      pullRequest: pullRequestOf(context, { ref, repoPath: source.repoPath, number: pullNumber }),
    }),
    ...(agentSessionUrl !== undefined && { agentSessionUrl }),
  };
}

/** The branch's pull request, and the session reviewing it in the same clone, if any. */
interface PullRequestLookup {
  readonly ref: BranchRef;
  readonly repoPath: string;
  readonly number: number;
}

function pullRequestOf(
  context: GithubContext,
  { ref, repoPath, number }: PullRequestLookup,
): NonNullable<RemoteBranchView['pullRequest']> {
  const htmlUrl = `https://${ref.host}/${ref.owner}/${ref.repo}/pull/${String(number)}`;
  const reviewing = findSessionBySource(context.session.db, {
    kind: 'github-pull-request',
    repoPath,
    baseRef: '',
    host: ref.host,
    owner: ref.owner,
    repo: ref.repo,
    number,
  });
  if (reviewing.ok && reviewing.value !== undefined) {
    return { number, htmlUrl, sessionId: reviewing.value.id };
  }
  return { number, htmlUrl };
}

async function readAgentSessionUrl(
  context: GithubContext,
  session: Session,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const repository = await openSessionRepository(context.session, session.source.repoPath, signal);
  if (!repository.ok) {
    return undefined;
  }
  const message = await readCommitMessage(repository.value, session.headSha, { signal });
  if (!message.ok || message.value === undefined) {
    return undefined;
  }
  return agentSessionUrlFrom(message.value);
}
