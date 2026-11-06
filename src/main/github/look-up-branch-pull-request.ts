import type { BranchRef } from '#internal/github/branch-ref.ts';
import { findBranchPullRequest } from '#internal/github/find-branch-pull-request.ts';
import type { RepositoryName } from '#internal/github/get-repository.ts';
import { pullRequestBases } from '#internal/github/pull-request-bases.ts';
import type { PullRequest } from '#internal/github/pull-request.ts';

import type { GithubContext } from './github-context.ts';

/** What one repository last answered about the branch's pull request, and its ETag. */
export interface PullRequestAnswer {
  readonly etag: string | undefined;
  readonly pullRequest: PullRequest | undefined;
}

/** The last answer of each asked repository, by lowercase `owner/repo`, for conditional asks. */
export type PullRequestAnswers = Map<string, PullRequestAnswer>;

/** A followed branch's open pull request, and the repository it is into. */
export interface BranchPullRequest {
  readonly base: RepositoryName;
  readonly pullRequest: PullRequest;
}

/** `unknown` when a repository asked before any that lists one couldn't be read. */
export type BranchPullRequestLookup =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'known'; readonly found: BranchPullRequest | undefined };

/** The branch, the repositories its fork came from, and how to ask. */
export interface BranchPullRequestSearch {
  readonly ref: BranchRef;
  readonly parent: RepositoryName | undefined;
  readonly source: RepositoryName | undefined;
  /** The poll's remembered answers: asks are conditional on them and update them. */
  readonly answers?: PullRequestAnswers | undefined;
  /** Answer from `answers` alone, asking GitHub nothing. */
  readonly isOffline?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The open pull request for a followed branch (ADR 0112 and its fork amendment): the branch's
 * own repository is asked first, then its fork's parent, then the root of the fork network; the
 * first that lists one wins. A 304 reuses the remembered answer.
 */
export async function lookUpBranchPullRequest(
  context: GithubContext,
  search: BranchPullRequestSearch,
): Promise<BranchPullRequestLookup> {
  const { ref, parent, source } = search;
  const bases = pullRequestBases({ repository: ref, parent, source });
  for (const base of bases) {
    const answer = await answerOf(context, search, base);
    if (answer === undefined) {
      return { kind: 'unknown' };
    }
    if (answer.pullRequest !== undefined) {
      return { kind: 'known', found: { base, pullRequest: answer.pullRequest } };
    }
  }
  return { kind: 'known', found: undefined };
}

async function answerOf(
  context: GithubContext,
  { ref, answers, isOffline = false, signal }: BranchPullRequestSearch,
  base: RepositoryName,
): Promise<PullRequestAnswer | undefined> {
  const key = `${base.owner}/${base.repo}`.toLowerCase();
  const remembered = answers?.get(key);
  if (isOffline) {
    return remembered;
  }
  const listed = await context.clients.withClient(ref.host, async (client) => {
    return findBranchPullRequest(
      client,
      { base, head: ref },
      { ...(remembered?.etag !== undefined && { etag: remembered.etag }), signal },
    );
  });
  if (!listed.ok) {
    context.session.logger.info('github: pull requests unavailable', {
      repository: key,
      kind: listed.error.kind,
    });
    return undefined;
  }
  if (listed.value.kind === 'not-modified') {
    return remembered;
  }
  const answer: PullRequestAnswer = { etag: listed.value.etag, pullRequest: listed.value.value };
  answers?.set(key, answer);
  return answer;
}
