import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequest, PullRequestRef } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';

/** A fresh pull request with the ETag to poll with, or `not-modified` for a matching ETag. */
export type Conditional<T> =
  | { readonly kind: 'modified'; readonly value: T; readonly etag: string | undefined }
  | { readonly kind: 'not-modified' };

export interface PullRequestPollOptions extends GithubCallOptions {
  /** The previous response's ETag: an unchanged pull request then answers 304. */
  readonly etag?: string;
}

/**
 * `GET /repos/{owner}/{repo}/pulls/{number}`. Pass the previous `etag` when polling for a new head:
 * an unchanged pull request answers 304, which GitHub doesn't count against the rate limit.
 */
export async function getPullRequest<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: PullRequestPollOptions = {},
): Promise<Result<Conditional<PullRequest>, GithubError<E>>> {
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  if (response.value.status === 304) {
    return ok({ kind: 'not-modified' });
  }
  const decoded = decodeWith(pullRequestSchema, response.value.body);
  if (decoded.ok) {
    return ok({ kind: 'modified', value: decoded.value, etag: response.value.etag });
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}
