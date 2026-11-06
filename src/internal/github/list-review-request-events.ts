import { z } from 'zod';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';

/** One `review_requested` event: who was asked (a login or a team slug) and when. */
export interface ReviewRequestEvent {
  /** An ISO 8601 instant. */
  readonly at: string;
  /** The requested user's login, for a request of a person. */
  readonly reviewer?: string;
  /** The requested team's slug, for a request of a team (of the repository owner's organization). */
  readonly team?: string;
}

/** A pull request's review requests, oldest first. */
export interface ReviewRequestEvents {
  readonly events: readonly ReviewRequestEvent[];
  /** More pages existed than were read, so later requests may be missing. */
  readonly isTruncated: boolean;
}

const eventSchema = z
  .object({
    event: z.string(),
    created_at: z.iso.datetime({ offset: true }),
    requested_reviewer: z.object({ login: z.string() }).nullable().optional(),
    requested_team: z.object({ slug: z.string() }).nullable().optional(),
  })
  .transform((raw): ReviewRequestEvent | undefined => {
    if (raw.event !== 'review_requested') {
      return undefined;
    }
    if (raw.requested_reviewer != undefined) {
      return { at: raw.created_at, reviewer: raw.requested_reviewer.login };
    }
    if (raw.requested_team != undefined) {
      return { at: raw.created_at, team: raw.requested_team.slug };
    }
    return undefined;
  });

const pageSchema = z.array(eventSchema);

/**
 * The `review_requested` events of a pull request, oldest first (`GET
 * /repos/{o}/{r}/issues/{n}/events`, ADR 0113 amendment): when each person or team was asked to
 * review, re-requests included. Other events are left out.
 */
export async function listReviewRequestEvents<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: GithubCallOptions = {},
): Promise<Result<ReviewRequestEvents, GithubError<E>>> {
  const pages = await fetchAllPages(
    client,
    {
      method: 'GET',
      path: githubPath`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/events`,
      query: { per_page: 100 },
      ...options,
    },
    (body) => {
      const decoded = decodeWith(pageSchema, body);
      if (decoded.ok) {
        return ok(decoded.value.filter((event) => event !== undefined));
      }
      return decoded;
    },
  );
  if (!pages.ok) {
    return pages;
  }
  return ok({ events: pages.value.items, isTruncated: pages.value.isTruncated });
}
