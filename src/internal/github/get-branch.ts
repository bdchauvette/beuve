import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef, RemoteBranchTip } from './branch-ref.ts';
import { decodeWith } from './decode-with.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { Conditional, PullRequestPollOptions } from './get-pull-request.ts';

const branchSchema = z
  .object({
    name: z.string(),
    commit: z.object({
      sha: z
        .string()
        .regex(/^(?:[\da-f]{40}|[\da-f]{64})$/iu)
        .transform((sha) => sha.toLowerCase()),
    }),
  })
  .transform((raw): RemoteBranchTip => {
    return { name: raw.name, sha: raw.commit.sha };
  });

/**
 * `GET /repos/{owner}/{repo}/branches/{branch}` (ADR 0112): the branch's tip. Pass the previous
 * `etag` when polling: an unchanged branch answers 304, which costs no rate limit. A deleted
 * branch is `not-found`. The branch's segments are encoded one by one, so its slashes stay path
 * separators, as GitHub expects.
 */
export async function getBranch<E>(
  client: GithubClient<E>,
  ref: Omit<BranchRef, 'host'>,
  options: PullRequestPollOptions = {},
): Promise<Result<Conditional<RemoteBranchTip>, GithubError<E>>> {
  const segments = ref.branch.split('/').map((segment) => encodeURIComponent(segment));
  const response = await client.send({
    method: 'GET',
    path: `${githubPath`/repos/${ref.owner}/${ref.repo}/branches`}/${segments.join('/')}`,
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  if (response.value.status === 304) {
    return ok({ kind: 'not-modified' });
  }
  const decoded = decodeWith(branchSchema, response.value.body);
  if (decoded.ok) {
    return ok({ kind: 'modified', value: decoded.value, etag: response.value.etag });
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}
