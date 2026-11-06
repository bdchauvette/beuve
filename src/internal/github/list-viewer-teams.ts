import { z } from 'zod';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';

/** A team the signed-in user is on: its organization's login and its slug. */
export interface ViewerTeam {
  readonly organization: string;
  readonly slug: string;
}

const teamSchema = z
  .object({ slug: z.string(), organization: z.object({ login: z.string() }) })
  .transform((raw): ViewerTeam => {
    return { organization: raw.organization.login, slug: raw.slug };
  });

const pageSchema = z.array(teamSchema);

/**
 * `GET /user/teams` (ADR 0113 amendment): every team the signed-in user is on, across their
 * organizations. A classic token needs `read:org` for it.
 */
export async function listViewerTeams<E>(
  client: GithubClient<E>,
  options: GithubCallOptions = {},
): Promise<Result<readonly ViewerTeam[], GithubError<E>>> {
  const pages = await fetchAllPages(
    client,
    { method: 'GET', path: '/user/teams', query: { per_page: 100 }, ...options },
    (body) => {
      return decodeWith(pageSchema, body);
    },
  );
  if (!pages.ok) {
    return pages;
  }
  return ok(pages.value.items);
}
