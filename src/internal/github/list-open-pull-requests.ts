import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { Conditional, PullRequestPollOptions } from './get-pull-request.ts';
import type { RepositoryName } from './get-repository.ts';
import { parseLinkHeader } from './parse-link-header.ts';
import type { PullRequest } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';

/** A repository's open pull requests, as far as one page holds them. */
export interface OpenPullRequests {
  readonly items: readonly PullRequest[];
  /** More than one page was open; only the most recently updated 100 are listed. */
  readonly isTruncated: boolean;
}

const pageSchema = z.array(pullRequestSchema);

/**
 * `GET /repos/{o}/{r}/pulls?state=open&per_page=100&sort=updated` (ADR 0113): the open pull
 * requests of a repository, one page, conditional on `etag`. The review queue reads it once per
 * repository to tell which branches already have a pull request, instead of asking per branch.
 */
export async function listOpenPullRequests<E>(
  client: GithubClient<E>,
  repository: RepositoryName,
  options: PullRequestPollOptions = {},
): Promise<Result<Conditional<OpenPullRequests>, GithubError<E>>> {
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${repository.owner}/${repository.repo}/pulls`,
    query: { state: 'open', sort: 'updated', direction: 'desc', per_page: 100 },
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  if (response.value.status === 304) {
    return ok({ kind: 'not-modified' });
  }
  const decoded = decodeWith(pageSchema, response.value.body);
  if (!decoded.ok) {
    return err({ kind: 'unexpected-shape', reason: decoded.error });
  }
  return ok({
    kind: 'modified',
    value: {
      items: decoded.value,
      isTruncated: parseLinkHeader(response.value.link).has('next'),
    },
    etag: response.value.etag,
  });
}
