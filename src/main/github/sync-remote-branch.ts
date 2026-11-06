import type { GithubFailureView } from '#contract/ipc-contract.ts';
import { fetchRefs } from '#internal/git/fetch-refs.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import type { BranchRef, RemoteBranchTip } from '#internal/github/branch-ref.ts';
import { buildBranchFetch } from '#internal/github/build-branch-fetch.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { githubFailure } from './github-failure.ts';

/** A followed branch whose head and base are in the local clone, at the tip GitHub reported. */
export interface SyncedBranch {
  /** The tip the fetched head matched, asked for again if the first fetch raced a push. */
  readonly tip: RemoteBranchTip;
  readonly headSha: CommitSha;
  /** Where the default branch landed, `refs/beuve/branch/<key>/base`: the session's `baseRef`. */
  readonly baseRef: string;
}

export interface SyncBranchInput {
  readonly repository: GitRepository;
  /** The clone's remote for the branch's repository. */
  readonly remote: string;
  readonly ref: BranchRef;
  readonly defaultBranch: string;
  readonly tip: RemoteBranchTip;
  /** Asks GitHub for the branch again, after a fetch found a head GitHub didn't report. */
  readonly refetch: () => Promise<Result<RemoteBranchTip, GithubFailureView>>;
  readonly signal?: AbortSignal | undefined;
  readonly logger: Logger;
}

/**
 * Fetches a followed branch and the default branch into `refs/beuve/branch/<key>/…` (ADR 0112)
 * and checks the fetched head is the tip GitHub reported. A push between the API call and the
 * fetch makes them differ; the branch is then asked for again and fetched once more, and only a
 * second mismatch fails (`head-mismatch`), as for pull requests (ADR 0037).
 */
export async function syncRemoteBranch(
  input: SyncBranchInput,
): Promise<Result<SyncedBranch, GithubFailureView>> {
  const first = await fetchAndVerify(input, input.tip);
  if (!first.ok || first.value.headSha === input.tip.sha) {
    return first;
  }
  input.logger.info('github: fetched branch differs from the API; asking again', {
    branch: input.ref.branch,
  });
  const again = await input.refetch();
  if (!again.ok) {
    return again;
  }
  const second = await fetchAndVerify(input, again.value);
  if (!second.ok || second.value.headSha === again.value.sha) {
    return second;
  }
  return err(
    githubFailure(
      'head-mismatch',
      `The fetched head of ${input.ref.branch} is not the commit GitHub reports. The branch may still be updating; try again.`,
    ),
  );
}

async function fetchAndVerify(
  input: SyncBranchInput,
  tip: RemoteBranchTip,
): Promise<Result<SyncedBranch, GithubFailureView>> {
  const plan = buildBranchFetch({ ref: input.ref, defaultBranch: input.defaultBranch });
  if (!plan.ok) {
    return err(githubFailure('fetch-failed', plan.error));
  }
  const { refspecs, headRef, baseRef } = plan.value;
  const fetched = await fetchRefs(
    input.repository,
    { remote: input.remote, refspecs },
    { signal: input.signal },
  );
  if (!fetched.ok) {
    input.logger.warn('github: branch fetch failed', { error: fetched.error });
    let detail = '';
    if (fetched.error.kind === 'command-failed') {
      detail = `: ${fetched.error.stderr.trim().split('\n').at(-1)?.slice(0, 300) ?? ''}`;
    }
    return err(githubFailure('fetch-failed', `git fetch from ${input.remote} failed${detail}`));
  }
  const head = await resolveRevision(input.repository, headRef);
  if (!head.ok) {
    return err(githubFailure('fetch-failed', `${headRef} is missing after the fetch`));
  }
  return ok({ tip, headSha: head.value, baseRef });
}
