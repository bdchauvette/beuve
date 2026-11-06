import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubClient, GithubRequest } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import type { Conditional, PullRequestPollOptions } from './get-pull-request.ts';
import { parseLinkHeader } from './parse-link-header.ts';

/** A pull request as the issue search lists it: no branches, SHAs or size. */
export interface SearchedPullRequest {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  /** The author's login, `ghost` for a deleted account. */
  readonly author: string;
  readonly isDraft: boolean;
  readonly htmlUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One search's results, newest update first. */
export interface SearchResults {
  readonly items: readonly SearchedPullRequest[];
  /** GitHub had more than the pages read, or said its results were incomplete. */
  readonly isTruncated: boolean;
  /**
   * How many organizations GitHub left out because the token is not authorized for their SAML
   * SSO (`X-GitHub-SSO: partial-results; organizations=…`); 0 when none were.
   */
  readonly hiddenOrganizations: number;
  /** The token's scopes from `X-OAuth-Scopes`; `undefined` for tokens that have none (fine-grained). */
  readonly scopes: readonly string[] | undefined;
}

/** A search, and how many pages of 100 to read at most (default 2). */
export interface SearchOptions extends PullRequestPollOptions {
  readonly maxPages?: number;
}

const repositoryPath = /\/repos\/(?<owner>[^/]+)\/(?<repo>[^/]+)$/u;

const itemSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    draft: z.boolean().optional(),
    user: z.object({ login: z.string() }).nullable(),
    html_url: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    repository_url: z.string(),
    pull_request: z.object({}).optional(),
  })
  .transform((raw): SearchedPullRequest | undefined => {
    const match = repositoryPath.exec(URL.parse(raw.repository_url)?.pathname ?? '');
    const { owner, repo } = match?.groups ?? {};
    if (owner === undefined || repo === undefined || raw.pull_request === undefined) {
      return undefined;
    }
    return {
      owner: decodeURIComponent(owner),
      repo: decodeURIComponent(repo),
      number: raw.number,
      title: raw.title,
      author: raw.user?.login ?? 'ghost',
      isDraft: raw.draft ?? false,
      htmlUrl: raw.html_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  });

const pageSchema = z
  .object({
    incomplete_results: z.boolean().optional(),
    items: z.array(itemSchema),
  })
  .transform((raw): SearchPage => {
    return {
      items: raw.items.filter((item) => item !== undefined),
      isTruncated: raw.incomplete_results ?? false,
    };
  });

/** One page of results, before the response headers are read. */
type SearchPage = Pick<SearchResults, 'items' | 'isTruncated'>;

/**
 * `GET /search/issues?q=<query>` for pull requests (ADR 0113), most recently updated first, up to
 * `maxPages` pages of 100. Search has its own rate limit (30 requests a minute), so callers pace
 * themselves. With `etag` an unchanged first page answers `not-modified`; an ETag is returned only
 * when everything fit on that page. Results that are issues, or whose repository can't be read,
 * are dropped.
 */
export async function searchPullRequests<E>(
  client: GithubClient<E>,
  query: string,
  options: SearchOptions = {},
): Promise<Result<Conditional<SearchResults>, GithubError<E>>> {
  const { maxPages = 2, etag, signal } = options;
  const request: GithubRequest = {
    method: 'GET',
    path: '/search/issues',
    query: { q: query, sort: 'updated', order: 'desc', per_page: 100 },
    ...(etag !== undefined && { etag }),
    signal,
  };
  const first = await client.send(request);
  if (!first.ok) {
    return first;
  }
  if (first.value.status === 304) {
    return ok({ kind: 'not-modified' });
  }
  const decoded = decodeWith(pageSchema, first.value.body);
  if (!decoded.ok) {
    return err({ kind: 'unexpected-shape', reason: decoded.error });
  }
  const headers = {
    hiddenOrganizations: hiddenOrganizationsOf(first.value.sso),
    scopes: scopesOf(first.value.oauthScopes),
  };
  const next = parseLinkHeader(first.value.link).get('next');
  if (next === undefined) {
    return ok({
      kind: 'modified',
      value: { ...decoded.value, ...headers },
      etag: first.value.etag,
    });
  }
  const rest = await fetchAllPages(
    client,
    { method: 'GET', path: next, signal, maxPages: maxPages - 1 },
    (body) => {
      const page = decodeWith(pageSchema, body);
      if (page.ok) {
        return ok(page.value.items);
      }
      return page;
    },
  );
  if (!rest.ok) {
    return rest;
  }
  return ok({
    kind: 'modified',
    value: {
      items: [...decoded.value.items, ...rest.value.items],
      isTruncated: decoded.value.isTruncated || rest.value.isTruncated,
      ...headers,
    },
    etag: undefined,
  });
}

/** The organizations a `partial-results; organizations=1,2` SSO header names; 0 without one. */
function hiddenOrganizationsOf(sso = ''): number {
  const parts = sso.split(';').map((part) => part.trim());
  if (parts[0] !== 'partial-results') {
    return 0;
  }
  const listed = parts.find((part) => part.startsWith('organizations='));
  if (listed === undefined) {
    return 1;
  }
  return listed
    .slice('organizations='.length)
    .split(',')
    .filter((id) => id.trim() !== '').length;
}

/** `X-OAuth-Scopes: repo, read:org` as a list; `undefined` when the header was absent. */
function scopesOf(header: string | undefined): readonly string[] | undefined {
  if (header === undefined) {
    return undefined;
  }
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '');
}
