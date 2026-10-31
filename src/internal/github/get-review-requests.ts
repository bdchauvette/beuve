import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { ReviewRequests } from './pull-request-review.ts';

const userSchema = z.object({ login: z.string() });
const teamSchema = z.object({ slug: z.string() });

const requestsSchema = z
  .object({
    users: z.array(userSchema),
    teams: z.array(teamSchema),
  })
  .transform((raw): ReviewRequests => {
    return {
      users: raw.users.map((user) => user.login),
      teams: raw.teams.map((team) => team.slug),
    };
  });

/** `GET /repos/{o}/{r}/pulls/{n}/requested_reviewers`: who has been asked to review and not yet has. */
export async function getReviewRequests<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: GithubCallOptions = {},
): Promise<Result<ReviewRequests, GithubError<E>>> {
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/requested_reviewers`,
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  const decoded = decodeWith(requestsSchema, response.value.body);
  if (decoded.ok) {
    return ok(decoded.value);
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}
