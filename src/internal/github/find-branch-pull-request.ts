import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef } from './branch-ref.ts';
import { decodeWith } from './decode-with.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { Conditional, PullRequestPollOptions } from './get-pull-request.ts';
import type { PullRequest } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';

const pageSchema = z.array(pullRequestSchema);

/**
 * The open pull request whose head is this branch of this repository (ADR 0112):
 * `GET /repos/{o}/{r}/pulls?state=open&head={o}:{branch}`, conditional on `etag`. Only pull
 * requests within the repository are found, not ones from it into another; of several (into
 * different bases), the lowest number. `undefined` when there is none.
 */
export async function findBranchPullRequest<E>(
  client: GithubClient<E>,
  ref: Omit<BranchRef, 'host'>,
  options: PullRequestPollOptions = {},
): Promise<Result<Conditional<PullRequest | undefined>, GithubError<E>>> {
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls`,
    query: { state: 'open', head: `${ref.owner}:${ref.branch}`, per_page: 100 },
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
  const fullName = `${ref.owner}/${ref.repo}`.toLowerCase();
  const [first] = decoded.value
    .filter((candidate) => {
      return (
        candidate.state === 'open' &&
        candidate.head.ref === ref.branch &&
        candidate.base.repository?.fullName.toLowerCase() === fullName &&
        candidate.head.repository?.fullName.toLowerCase() === fullName
      );
    })
    .toSorted((a, b) => a.number - b.number);
  return ok({ kind: 'modified', value: first, etag: response.value.etag });
}
