import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef } from './branch-ref.ts';
import { decodeWith } from './decode-with.ts';
import type { RepositoryName } from './get-repository.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { Conditional, PullRequestPollOptions } from './get-pull-request.ts';
import type { PullRequest } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';

const pageSchema = z.array(pullRequestSchema);

/** Where to look for a branch's pull request, and the branch. */
export interface BranchPullRequestQuery {
  /** The repository whose pull requests are listed: the branch's own, or an upstream of its fork. */
  readonly base: RepositoryName;
  /** The branch, in the repository that holds it. */
  readonly head: Omit<BranchRef, 'host'>;
}

/**
 * The open pull request into `base` whose head is this branch (ADR 0112 and its fork amendment):
 * `GET /repos/{base}/pulls?state=open&head={head.owner}:{branch}`, conditional on `etag`. Only a
 * pull request whose head repository is the branch's own is found; of several (into different
 * base branches), the lowest number. `undefined` when there is none.
 */
export async function findBranchPullRequest<E>(
  client: GithubClient<E>,
  { base, head }: BranchPullRequestQuery,
  options: PullRequestPollOptions = {},
): Promise<Result<Conditional<PullRequest | undefined>, GithubError<E>>> {
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${base.owner}/${base.repo}/pulls`,
    query: { state: 'open', head: `${head.owner}:${head.branch}`, per_page: 100 },
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
  const baseName = `${base.owner}/${base.repo}`.toLowerCase();
  const headName = `${head.owner}/${head.repo}`.toLowerCase();
  const [first] = decoded.value
    .filter((candidate) => {
      return (
        candidate.state === 'open' &&
        candidate.head.ref === head.branch &&
        candidate.base.repository?.fullName.toLowerCase() === baseName &&
        candidate.head.repository?.fullName.toLowerCase() === headName
      );
    })
    .toSorted((a, b) => a.number - b.number);
  return ok({ kind: 'modified', value: first, etag: response.value.etag });
}
