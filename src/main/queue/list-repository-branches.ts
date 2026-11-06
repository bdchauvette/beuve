import type { RemoteBranchTip, RepositoryDetails } from '#internal/github/branch-ref.ts';
import { compareCommits } from '#internal/github/compare-commits.ts';
import type { Comparison } from '#internal/github/compare-commits.ts';
import { getRepository } from '#internal/github/get-repository.ts';
import { listMatchingBranches } from '#internal/github/list-matching-branches.ts';
import { listOpenPullRequests } from '#internal/github/list-open-pull-requests.ts';
import type { RepositoryName } from '#internal/github/get-repository.ts';
import { mapConcurrently } from '#x/async/map-concurrently.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { RepositoryKey } from '../github/create-clone-path-settings.ts';

import type { QueueCache } from './create-queue-cache.ts';
import type { QueueCallError, QueueRun } from './queue-run.ts';

/** A branch with no open pull request that is ahead of the default branch. */
export interface BranchCandidate {
  readonly host: string;
  readonly repository: RepositoryDetails;
  readonly tip: RemoteBranchTip;
  readonly comparison: Comparison;
  /** A step of the listing failed and its last answer stood in. */
  readonly isStale: boolean;
}

/** One repository's branch listing: where, under which prefixes, remembering what. */
export interface RepositoryBranches {
  readonly repository: RepositoryKey;
  readonly prefixes: readonly string[];
  readonly cache: QueueCache;
}

/**
 * The agent branches of one repository that have no open pull request and are ahead of its
 * default branch (ADR 0113): the repository (once a run), each prefix's matching refs and the open
 * pull requests (both conditional on their ETags), then a compare per new head. A failed step is
 * reported and answered from its last result.
 */
export async function listRepositoryBranches(
  run: QueueRun,
  { repository, prefixes, cache }: RepositoryBranches,
): Promise<readonly BranchCandidate[]> {
  const { host } = repository;
  const repoKey = `${host}/${repository.owner}/${repository.repo}`.toLowerCase();
  const source = `${host}/${repository.owner}/${repository.repo} branches`;
  const problemsBefore = run.problems.length;
  const details = await repositoryDetails(run, { repository, repoKey, cache });
  if (!details.ok) {
    run.report(source, details.error);
    return [];
  }
  const { value: target } = details;
  const name = { owner: target.owner, repo: target.repo };
  const tips = new Map<string, RemoteBranchTip>();
  for (const prefix of prefixes) {
    const cacheKey = `${repoKey} ${prefix}`;
    const cached = cache.branches.get(cacheKey);
    const listed = await run.withClient(host, async (client) => {
      return listMatchingBranches(
        client,
        { ...name, prefix },
        { ...(cached?.etag !== undefined && { etag: cached.etag }), signal: run.signal },
      );
    });
    let found = cached?.tips ?? [];
    if (!listed.ok) {
      run.report(source, listed.error);
    } else if (listed.value.kind === 'modified') {
      found = listed.value.value;
      cache.branches.set(cacheKey, { etag: listed.value.etag, tips: found });
    }
    for (const tip of found) {
      if (tip.name !== target.defaultBranch) {
        tips.set(tip.name, tip);
      }
    }
  }
  if (tips.size === 0) {
    return [];
  }
  const withPulls = await openPullHeads(run, { host, name, repoKey, cache });
  const unpulled = tips
    .values()
    .filter((tip) => !withPulls.has(tip.name))
    .toArray();
  const compared = await mapConcurrently(unpulled, { limit: 4 }, async (tip) => {
    return compareTip(run, { host, target, tip, repoKey, cache });
  });
  const isStale = run.problems.length > problemsBefore;
  return compared
    .filter((candidate) => candidate !== undefined)
    .map((candidate) => {
      return { ...candidate, isStale };
    });
}

/** What the repository lookup needs. */
interface RepositoryLookup {
  readonly repository: RepositoryKey;
  readonly repoKey: string;
  readonly cache: QueueCache;
}

/** The repository's canonical name and default branch, asked once a run per repository. */
async function repositoryDetails(
  run: QueueRun,
  { repository, repoKey, cache }: RepositoryLookup,
): Promise<Result<RepositoryDetails, QueueCallError>> {
  const cached = cache.repositories.get(repoKey);
  if (cached !== undefined) {
    return ok(cached);
  }
  const answer = await run.withClient(repository.host, async (client) => {
    return getRepository(
      client,
      { owner: repository.owner, repo: repository.repo },
      { signal: run.signal },
    );
  });
  if (answer.ok) {
    cache.repositories.set(repoKey, answer.value);
  }
  return answer;
}

/** What the open pull request lookup needs. */
interface OpenPullLookup {
  readonly host: string;
  readonly name: RepositoryName;
  readonly repoKey: string;
  readonly cache: QueueCache;
}

/**
 * The head branches of the repository's open pull requests within it, conditional on the last
 * ETag; the last answer (or none) when GitHub does not answer.
 */
async function openPullHeads(
  run: QueueRun,
  { host, name, repoKey, cache }: OpenPullLookup,
): Promise<ReadonlySet<string>> {
  const cached = cache.openPulls.get(repoKey);
  const listed = await run.withClient(host, async (client) => {
    return listOpenPullRequests(client, name, {
      ...(cached?.etag !== undefined && { etag: cached.etag }),
      signal: run.signal,
    });
  });
  if (!listed.ok) {
    run.report(`${host}/${name.owner}/${name.repo} pull requests`, listed.error);
    return cached?.heads ?? new Set();
  }
  if (listed.value.kind === 'not-modified') {
    return cached?.heads ?? new Set();
  }
  const fullName = `${name.owner}/${name.repo}`.toLowerCase();
  const heads = new Set(
    listed.value.value.items
      .filter((pull) => pull.head.repository?.fullName.toLowerCase() === fullName)
      .map((pull) => pull.head.ref),
  );
  cache.openPulls.set(repoKey, { etag: listed.value.etag, heads });
  return heads;
}

/** One branch tip to compare with its repository's default branch. */
interface TipComparison {
  readonly host: string;
  readonly target: RepositoryDetails;
  readonly tip: RemoteBranchTip;
  readonly repoKey: string;
  readonly cache: QueueCache;
}

/**
 * The branch as a candidate when it is ahead of the default branch: compared once per head and
 * default branch, so an unchanged branch costs nothing. `undefined` for a branch with nothing of
 * its own (merged, or identical), or one GitHub could not compare.
 */
async function compareTip(
  run: QueueRun,
  { host, target, tip, repoKey, cache }: TipComparison,
): Promise<BranchCandidate | undefined> {
  const cacheKey = `${repoKey}:${tip.name}`;
  const cached = cache.comparisons.get(cacheKey);
  let comparison = cached?.comparison;
  if (cached?.headSha !== tip.sha || cached.base !== target.defaultBranch) {
    const answer = await run.withClient(host, async (client) => {
      return compareCommits(
        client,
        { owner: target.owner, repo: target.repo, base: target.defaultBranch, head: tip.sha },
        { signal: run.signal },
      );
    });
    if (!answer.ok) {
      run.report(`${host}/${target.owner}/${target.repo}:${tip.name}`, answer.error);
      return undefined;
    }
    comparison = answer.value;
    cache.comparisons.set(cacheKey, {
      base: target.defaultBranch,
      headSha: tip.sha,
      comparison,
    });
  }
  if (comparison === undefined || comparison.aheadBy === 0) {
    return undefined;
  }
  return { host, repository: target, tip, comparison, isStale: false };
}
