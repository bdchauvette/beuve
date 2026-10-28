import type { GithubFailureView } from '#contract/ipc-contract.ts';
import { fetchRefs } from '#internal/git/fetch-refs.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { buildPullRequestFetch } from '#internal/github/build-pull-request-fetch.ts';
import type { PullRequest } from '#internal/github/pull-request.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { githubFailure } from './github-failure.ts';

/** A pull request whose head and base branch are in the local clone, at the SHAs GitHub reported. */
export interface SyncedPullRequest {
  /** The metadata the fetched head matched, refetched if the first attempt raced a push. */
  readonly pullRequest: PullRequest;
  readonly headSha: CommitSha;
  /** Where the base branch landed, `refs/beuve/pr/<n>/base`: the session's `baseRef`. */
  readonly baseRef: string;
}

export interface SyncPullRequestInput {
  readonly repository: GitRepository;
  /** The clone's remote for the pull request's base repository. */
  readonly remote: string;
  readonly pullRequest: PullRequest;
  /** Asks GitHub for the pull request again, after a fetch found a head GitHub didn't report. */
  readonly refetch: () => Promise<Result<PullRequest, GithubFailureView>>;
  readonly logger: Logger;
}

/**
 * Fetches `refs/pull/<n>/head` and the base branch into `refs/beuve/pr/<n>/…` (ADR 0035) and checks
 * the fetched head is the SHA GitHub reported. A force-push between the API call and the fetch
 * makes them differ; then the pull request is asked for again and fetched once more, and only a
 * second mismatch fails (`head-mismatch`).
 */
export async function syncPullRequestHead(
  input: SyncPullRequestInput,
): Promise<Result<SyncedPullRequest, GithubFailureView>> {
  const first = await fetchAndVerify(input, input.pullRequest);
  if (!first.ok || first.value.matches) {
    return first.ok ? ok(first.value.synced) : first;
  }
  input.logger.info('github: fetched head differs from the API; asking again', {
    number: input.pullRequest.number,
  });
  const again = await input.refetch();
  if (!again.ok) {
    return again;
  }
  const second = await fetchAndVerify(input, again.value);
  if (!second.ok || second.value.matches) {
    return second.ok ? ok(second.value.synced) : second;
  }
  return err(
    githubFailure(
      'head-mismatch',
      `The fetched head of #${String(again.value.number)} is not the commit GitHub reports. The pull request may still be updating; try again.`,
    ),
  );
}

async function fetchAndVerify(
  input: SyncPullRequestInput,
  pullRequest: PullRequest,
): Promise<
  Result<{ readonly matches: boolean; readonly synced: SyncedPullRequest }, GithubFailureView>
> {
  const plan = buildPullRequestFetch({
    number: pullRequest.number,
    remote: input.remote,
    baseBranch: pullRequest.base.ref,
  });
  if (!plan.ok || plan.value.baseRef === undefined) {
    return err(githubFailure('fetch-failed', plan.ok ? 'no base branch' : plan.error));
  }
  const { args, headRef, baseRef } = plan.value;
  const refspecs = args.slice(args.indexOf('--end-of-options') + 2);
  const fetched = await fetchRefs(input.repository, input.remote, refspecs);
  if (!fetched.ok) {
    input.logger.warn('github: fetch failed', { error: fetched.error });
    return err(githubFailure('fetch-failed', describeFetchError(input.remote, fetched.error)));
  }
  const head = await resolveRevision(input.repository, headRef);
  if (!head.ok) {
    return err(githubFailure('fetch-failed', `${headRef} is missing after the fetch`));
  }
  return ok({
    matches: head.value === pullRequest.head.sha,
    synced: { pullRequest, headSha: head.value, baseRef },
  });
}

function describeFetchError(remote: string, error: GitError): string {
  if (error.kind === 'command-failed') {
    const last = error.stderr.trim().split('\n').at(-1)?.slice(0, 300) ?? '';
    return `git fetch from ${remote} failed${last === '' ? '' : `: ${last}`}`;
  }
  return error.kind === 'timeout'
    ? `git fetch from ${remote} timed out`
    : `git fetch from ${remote} failed (${error.kind})`;
}
