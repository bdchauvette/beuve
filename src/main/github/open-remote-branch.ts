import type {
  GithubFailureView,
  OpenPullRequestRequest,
  OpenPullRequestResponse,
  OpenRemoteBranchRequest,
  OpenRemoteBranchResponse,
} from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import type { BranchRef, RemoteBranchTip } from '#internal/github/branch-ref.ts';
import { findStoredBranch } from '#internal/github/find-stored-branch.ts';
import { getBranch } from '#internal/github/get-branch.ts';
import { getRepository } from '#internal/github/get-repository.ts';
import type { RepositoryName } from '#internal/github/get-repository.ts';
import { parseBranchRef } from '#internal/github/parse-branch-ref.ts';
import { saveStoredBranch } from '#internal/github/save-stored-branch.ts';
import type { BranchPullRequestRef } from '#internal/github/stored-branch.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import type { Session } from '#internal/session/session.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { RequestOptions } from '../request-options.ts';
import { sessionSummaryFrom } from '../sessions/session-summary-from.ts';

import { failureFromGithubError } from './failure-from-github-error.ts';
import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';
import { lookUpBranchPullRequest } from './look-up-branch-pull-request.ts';
import { openGithubClone } from './open-github-clone.ts';
import { readRemoteBranchView } from './read-remote-branch-view.ts';
import { syncRemoteBranch } from './sync-remote-branch.ts';
import { upsertFetchedSession } from './upsert-fetched-session.ts';

export interface OpenRemoteBranchOptions {
  /** Told once the session is stored, before `openRemoteBranch` answers. */
  readonly onOpened: (session: Session) => void;
  /** Opens the branch's pull request instead, when it has one and no branch session exists. */
  readonly openPullRequest: (
    request: OpenPullRequestRequest,
    options: RequestOptions,
  ) => Promise<OpenPullRequestResponse>;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `github:open-branch` (ADR 0112): resolves the repository (canonical name, default branch) and
 * the branch tip on GitHub, finds the local clone and its remote as `github:open-pr` does (never
 * cloning), fetches and verifies the branch and the default branch into `refs/beuve/branch/…`,
 * then creates or resumes the remote-branch session and stores the branch. A branch that already
 * has an open pull request, and no branch session in that clone, opens the pull request instead,
 * also when the branch is in a fork and the pull request into an upstream the clone has a remote
 * for; without that remote the branch is followed and the pull request recorded.
 */
export async function openRemoteBranch(
  context: GithubContext,
  request: OpenRemoteBranchRequest,
  { onOpened, openPullRequest, signal }: OpenRemoteBranchOptions,
): Promise<OpenRemoteBranchResponse> {
  const asked = parseBranchRef(request.ref);
  if (!asked.ok) {
    return githubFailure('invalid-ref', `Not a branch: ${asked.error}.`);
  }
  const resolved = await resolveBranch(context, asked.value, signal);
  if (!resolved.ok) {
    return resolved.error;
  }
  const { ref, defaultBranch, htmlUrl, tip, parent, source: upstream } = resolved.value;
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
    kind: 'remote-branch',
    repoPath: repository.value.root,
    forge: 'github',
    ...ref,
  } as const;
  const { db } = context.session;
  const before = findSessionBySource(db, { ...source, baseRef: '' });
  let observedFrom: Session | undefined;
  if (before.ok) {
    observedFrom = before.value;
  }
  let foundPullRequest: BranchPullRequestRef | undefined;
  if (observedFrom === undefined) {
    foundPullRequest = await findOpenPullRequest(context, {
      ref,
      parent,
      source: upstream,
      signal,
    });
  }
  if (
    foundPullRequest !== undefined &&
    remotes.ok &&
    findMatchingRemote(remotes.value, { ...foundPullRequest, host: ref.host }) !== undefined
  ) {
    const { owner, repo, number } = foundPullRequest;
    const opened = await openPullRequest(
      {
        ref: `${ref.host}/${owner}/${repo}#${String(number)}`,
        repoPath: repository.value.root,
      },
      { signal },
    );
    if (opened.kind === 'failed') {
      return opened;
    }
    return { kind: 'opened', session: opened.session, repoPath: opened.repoPath };
  }
  const synced = await syncRemoteBranch({
    repository: repository.value,
    remote: remote.name,
    ref,
    defaultBranch,
    tip,
    refetch: async () => {
      return fetchTip(context, ref, signal);
    },
    logger: context.session.logger,
    signal,
  });
  if (!synced.ok) {
    return synced.error;
  }
  const session = upsertFetchedSession(context.session, {
    source: { ...source, baseRef: synced.value.baseRef },
    headSha: synced.value.headSha,
    observedFrom,
  });
  if (!session.ok) {
    return githubFailure('github-failed', session.error.message);
  }
  const stored = findStoredBranch(db, ref);
  let pullRequest = foundPullRequest;
  if (stored.ok) {
    pullRequest ??= stored.value?.pullRequest;
  }
  saveStoredBranch(db, {
    ref,
    defaultBranch,
    htmlUrl,
    parent,
    source: upstream,
    headSha: session.value.headSha,
    state: 'present',
    pullRequest,
  });
  await context.clonePaths.write(ref, repository.value.root);
  onOpened(session.value);
  const branch = await readRemoteBranchView(context, session.value, signal);
  if (branch === undefined) {
    return githubFailure('github-failed', 'the branch could not be stored');
  }
  return {
    kind: 'opened',
    session: sessionSummaryFrom(session.value),
    branch,
    repoPath: repository.value.root,
  };
}

/**
 * A branch as GitHub names it now, its repository's default branch and its tip, and the
 * repositories its repository was forked from when it is a fork.
 */
interface ResolvedBranch {
  readonly ref: BranchRef;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly tip: RemoteBranchTip;
  readonly parent: RepositoryName | undefined;
  readonly source: RepositoryName | undefined;
}

async function resolveBranch(
  context: GithubContext,
  asked: BranchRef,
  signal: AbortSignal | undefined,
): Promise<Result<ResolvedBranch, GithubFailureView>> {
  const details = await context.clients.withClient(asked.host, async (client) => {
    return getRepository(client, asked, { signal });
  });
  if (!details.ok) {
    return err(failureFromGithubError(details.error, `${asked.owner}/${asked.repo}`));
  }
  const ref: BranchRef = {
    host: asked.host,
    owner: details.value.owner,
    repo: details.value.repo,
    branch: asked.branch,
  };
  const tip = await fetchTip(context, ref, signal);
  if (!tip.ok) {
    return tip;
  }
  return ok({
    ref,
    defaultBranch: details.value.defaultBranch,
    htmlUrl: `${details.value.htmlUrl}/tree/${ref.branch}`,
    tip: tip.value,
    parent: nameOf(details.value.parent),
    source: nameOf(details.value.source),
  });
}

function nameOf(repository: RepositoryName | undefined): RepositoryName | undefined {
  if (repository === undefined) {
    return undefined;
  }
  return { owner: repository.owner, repo: repository.repo };
}

/** The branch's tip as GitHub reports it now (unconditionally), or why it couldn't be read. */
async function fetchTip(
  context: GithubContext,
  ref: BranchRef,
  signal: AbortSignal | undefined,
): Promise<Result<RemoteBranchTip, GithubFailureView>> {
  const got = await context.clients.withClient(ref.host, async (client) => {
    return getBranch(client, ref, { signal });
  });
  if (!got.ok) {
    return err(failureFromGithubError(got.error, `${ref.owner}/${ref.repo}:${ref.branch}`));
  }
  if (got.value.kind === 'modified') {
    return ok(got.value.value);
  }
  return err(githubFailure('github-failed', 'GitHub answered 304 to an unconditional request'));
}

/** The branch, the repositories its fork came from, and the request's signal. */
interface OpenPullRequestSearch {
  readonly ref: BranchRef;
  readonly parent: RepositoryName | undefined;
  readonly source: RepositoryName | undefined;
  readonly signal: AbortSignal | undefined;
}

/** The branch's open pull request, in its repository or an upstream, if GitHub lists one. */
async function findOpenPullRequest(
  context: GithubContext,
  search: OpenPullRequestSearch,
): Promise<BranchPullRequestRef | undefined> {
  const lookup = await lookUpBranchPullRequest(context, search);
  if (lookup.kind === 'unknown' || lookup.found === undefined) {
    return undefined;
  }
  const { base, pullRequest } = lookup.found;
  return { owner: base.owner, repo: base.repo, number: pullRequest.number };
}
