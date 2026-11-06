import type { OpenPullRequestRequest, OpenPullRequestResponse } from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import { findStoredPullRequest } from '#internal/github/find-stored-pull-request.ts';
import { parsePullRequestRef } from '#internal/github/parse-pull-request-ref.ts';
import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';
import { savePullRequest } from '#internal/github/save-pull-request.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import type { Session } from '#internal/session/session.ts';
import { sessionSummaryFrom } from '../sessions/session-summary-from.ts';

import { canonicalPullRequestRef } from './canonical-pull-request-ref.ts';
import { fetchPullRequest } from './fetch-pull-request.ts';
import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';
import { openGithubClone } from './open-github-clone.ts';
import { syncPullRequestHead } from './sync-pull-request-head.ts';
import { pullRequestViewFrom } from './pull-request-view-from.ts';
import { upsertFetchedSession } from './upsert-fetched-session.ts';

/** A pull request session main has just opened or resumed. */
export interface OpenedPullRequest {
  readonly session: Session;
  readonly ref: PullRequestRef;
  readonly pullRequest: PullRequest;
}

export interface OpenPullRequestOptions {
  /** Told once the session is stored, before `openPullRequest` answers. */
  readonly onOpened: (opened: OpenedPullRequest) => void;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `github:open-pr` (ADR 0037): resolves the pull request on GitHub, finds the local clone (the
 * given path, else the one last used for its repository) and the remote in it that points at
 * the base repository, fetches and verifies the head, then creates or resumes the session and
 * stores the metadata. It never clones: without a matching clone it answers `needs-local-clone`.
 */
export async function openPullRequest(
  context: GithubContext,
  request: OpenPullRequestRequest,
  { onOpened, signal }: OpenPullRequestOptions,
): Promise<OpenPullRequestResponse> {
  const asked = parsePullRequestRef(request.ref);
  if (!asked.ok) {
    return githubFailure('invalid-ref', `Not a pull request: ${asked.error}.`);
  }
  const fetched = await fetchPullRequest(context.clients, asked.value, signal);
  if (!fetched.ok) {
    return fetched.error;
  }
  const ref = canonicalPullRequestRef(asked.value, fetched.value);
  const repository = await openGithubClone(context, {
    repository: ref,
    repoPath: request.repoPath,
    signal,
  });
  if (!repository.ok) {
    return repository.error;
  }
  const remotes = await listRemoteUrls(repository.value);
  let remote: RemoteUrl | undefined;
  if (remotes.ok) {
    remote = findMatchingRemote(remotes.value, ref);
  }
  if (remote === undefined) {
    return githubFailure(
      'needs-local-clone',
      `${repository.value.root} has no remote for ${ref.host}/${ref.owner}/${ref.repo}. Enter the path of a local clone of that repository.`,
    );
  }
  const source = {
    kind: 'github-pull-request',
    repoPath: repository.value.root,
    host: ref.host,
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
  } as const;
  const before = findSessionBySource(context.session.db, { ...source, baseRef: '' });
  const synced = await syncPullRequestHead({
    repository: repository.value,
    remote: remote.name,
    pullRequest: fetched.value,
    refetch: async () => {
      return fetchPullRequest(context.clients, ref, signal);
    },
    logger: context.session.logger,
    signal,
  });
  if (!synced.ok) {
    return synced.error;
  }
  let observedFrom: Session | undefined;
  if (before.ok) {
    observedFrom = before.value;
  }
  const session = upsertFetchedSession(context.session, {
    source: { ...source, baseRef: synced.value.baseRef },
    headSha: synced.value.headSha,
    observedFrom,
  });
  if (!session.ok) {
    return githubFailure('github-failed', session.error.message);
  }
  const { db } = context.session;
  savePullRequest(db, ref, synced.value.pullRequest);
  const stored = findStoredPullRequest(db, ref);
  if (!stored.ok || stored.value === undefined) {
    return githubFailure('github-failed', 'the pull request metadata could not be stored');
  }
  await context.clonePaths.write(ref, repository.value.root);
  onOpened({ session: session.value, ref, pullRequest: synced.value.pullRequest });
  return {
    kind: 'opened',
    session: sessionSummaryFrom(session.value),
    pullRequest: pullRequestViewFrom(stored.value),
    repoPath: repository.value.root,
  };
}
