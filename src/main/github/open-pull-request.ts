import type {
  GithubFailureView,
  OpenPullRequestRequest,
  OpenPullRequestResponse,
} from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { findStoredPullRequest } from '#internal/github/find-stored-pull-request.ts';
import { parsePullRequestRef } from '#internal/github/parse-pull-request-ref.ts';
import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';
import { savePullRequest } from '#internal/github/save-pull-request.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import type { Session } from '#internal/session/session.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { ipcErrorFromGitError } from '../sessions/ipc-error-from-git-error.ts';
import { sessionSummaryFrom } from '../sessions/session-summary-from.ts';

import { canonicalPullRequestRef } from './canonical-pull-request-ref.ts';
import { fetchPullRequest } from './fetch-pull-request.ts';
import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';
import { syncPullRequestHead } from './sync-pull-request-head.ts';
import { pullRequestViewFrom } from './pull-request-view-from.ts';
import { upsertPullRequestSession } from './upsert-pull-request-session.ts';

/** A pull request session main has just opened or resumed. */
export interface OpenedPullRequest {
  readonly session: Session;
  readonly ref: PullRequestRef;
  readonly pullRequest: PullRequest;
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
  onOpened: (opened: OpenedPullRequest) => void,
  signal?: AbortSignal,
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
  const repository = await openClone(context, ref, request.repoPath, signal);
  if (!repository.ok) {
    return repository.error;
  }
  const remotes = await listRemoteUrls(repository.value);
  const remote = remotes.ok ? findMatchingRemote(remotes.value, ref) : undefined;
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
    refetch: async () => fetchPullRequest(context.clients, ref, signal),
    logger: context.session.logger,
    signal,
  });
  if (!synced.ok) {
    return synced.error;
  }
  const session = upsertPullRequestSession(
    context.session,
    { ...source, baseRef: synced.value.baseRef },
    synced.value.headSha,
    before.ok ? before.value : undefined,
  );
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

async function openClone(
  context: GithubContext,
  ref: PullRequestRef,
  repoPath: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Result<GitRepository, GithubFailureView>> {
  const target = repoPath ?? (await context.clonePaths.read(ref));
  const name = `${ref.owner}/${ref.repo}`;
  if (target === undefined) {
    return err(
      githubFailure(
        'needs-local-clone',
        `Enter the path of a local clone of ${name}; beuve fetches the pull request into it.`,
      ),
    );
  }
  const opened = await openRepository(target, { ...context.session.git, signal });
  return opened.ok
    ? ok(opened.value)
    : err(
        githubFailure(
          'needs-local-clone',
          `${ipcErrorFromGitError(opened.error).message}. Enter the path of a local clone of ${name}.`,
        ),
      );
}
