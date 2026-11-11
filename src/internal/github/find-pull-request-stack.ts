import { z } from 'zod';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequest } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';

/** The direct neighbors of a pull request in a stack of branches within one repository. */
export interface PullRequestStack {
  /** Open pull requests whose head is this one's base branch (normally zero or one). */
  readonly parents: readonly PullRequest[];
  /** Open pull requests based on this one's head branch. */
  readonly children: readonly PullRequest[];
}

const pageSchema = z.array(pullRequestSchema);

/**
 * GitHub stack navigation (spec 1): `GET /pulls?state=open&head=<owner>:<base>` for the parent and
 * `?state=open&base=<head>` for the children, both in the base repository and both keeping only
 * pull requests whose head lives there too. A pull request from a fork has no children, because
 * its head branch isn't in the base repository. Only direct neighbors; walk further by calling
 * this again.
 */
export async function findPullRequestStack<E>(
  client: GithubClient<E>,
  pullRequest: PullRequest,
  signal?: AbortSignal,
): Promise<Result<PullRequestStack, GithubError<E>>> {
  const repository = pullRequest.base.repository;
  if (repository === undefined) {
    return ok({ parents: [], children: [] });
  }
  const list = async (
    query: Readonly<Record<string, string>>,
  ): Promise<Result<readonly PullRequest[], GithubError<E>>> => {
    const pages = await fetchAllPages(
      client,
      {
        method: 'GET',
        path: githubPath`/repos/${repository.owner}/${repository.name}/pulls`,
        query: { state: 'open', per_page: 100, ...query },
        ...(signal !== undefined && { signal }),
        maxPages: 3,
      },
      (body) => {
        return decodeWith(pageSchema, body);
      },
    );
    if (pages.ok) {
      return ok(
        pages.value.items.filter((candidate) => {
          return (
            candidate.number !== pullRequest.number &&
            candidate.head.repository?.fullName === repository.fullName
          );
        }),
      );
    }
    return pages;
  };

  const parents = await list({ head: `${repository.owner}:${pullRequest.base.ref}` });
  if (!parents.ok) {
    return parents;
  }
  const parent = parents.value.filter((candidate) => candidate.head.ref === pullRequest.base.ref);
  if (pullRequest.isCrossRepository) {
    return ok({ parents: parent, children: [] });
  }
  const children = await list({ base: pullRequest.head.ref });
  if (!children.ok) {
    return children;
  }
  return ok({
    parents: parent,
    children: children.value.filter((child) => child.base.ref === pullRequest.head.ref),
  });
}
