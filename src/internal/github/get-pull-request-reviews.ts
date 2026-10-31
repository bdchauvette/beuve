import { z } from 'zod';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { PullRequestReview, ReviewVerdict } from './pull-request-review.ts';

const verdicts: Readonly<Record<string, ReviewVerdict>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
};

const reviewSchema = z
  .object({
    user: z.object({ login: z.string() }).nullable(),
    state: z.string(),
    commit_id: z.string().nullable().optional(),
    submitted_at: z.string().nullable().optional(),
  })
  .transform((raw): PullRequestReview | undefined => {
    const verdict = verdicts[raw.state];
    if (verdict === undefined || raw.submitted_at == undefined) {
      return undefined;
    }
    return {
      reviewer: raw.user?.login ?? 'ghost',
      verdict,
      commitSha: raw.commit_id ?? undefined,
      submittedAt: raw.submitted_at,
    };
  });

const pageSchema = z.array(reviewSchema);

/**
 * The submitted reviews of a pull request, oldest first (`GET /repos/{o}/{r}/pulls/{n}/reviews`):
 * pending reviews, which only their author sees, and states GitHub may add later are left out.
 */
export async function getPullRequestReviews<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: { readonly signal?: AbortSignal | undefined } = {},
): Promise<Result<readonly PullRequestReview[], GithubError<E>>> {
  const pages = await fetchAllPages(
    client,
    {
      method: 'GET',
      path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`,
      query: { per_page: 100 },
      ...options,
    },
    (body) => {
      const decoded = decodeWith(pageSchema, body);
      if (decoded.ok) {
        return ok(decoded.value.filter((review) => review !== undefined));
      }
      return decoded;
    },
  );
  if (pages.ok) {
    return ok(pages.value.items);
  }
  return pages;
}
