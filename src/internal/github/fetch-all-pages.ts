import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GithubClient, GithubRequest } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { parseLinkHeader } from './parse-link-header.ts';

export interface Pages<T> {
  readonly items: readonly T[];
  /** More pages existed past `maxPages`. */
  readonly isTruncated: boolean;
}

/**
 * Every page of a list endpoint: sends `request` (add `per_page: 100` to its query), decodes each
 * page with `decodePage` and follows `Link: rel="next"` up to `maxPages` (default 10). The client
 * refuses a next URL off the API origin. The first decoding or HTTP error wins.
 */
export async function fetchAllPages<T, E>(
  client: GithubClient<E>,
  request: GithubRequest,
  decodePage: (body: unknown) => Result<readonly T[], string>,
  maxPages = 10,
): Promise<Result<Pages<T>, GithubError<E>>> {
  const items: T[] = [];
  let next: GithubRequest | undefined = request;
  for (let page = 0; next !== undefined; page += 1) {
    if (page === maxPages) {
      return ok({ items, isTruncated: true });
    }
    const response = await client.send(next);
    if (!response.ok) {
      return response;
    }
    const decoded = decodePage(response.value.body);
    if (!decoded.ok) {
      return err({ kind: 'unexpected-shape', reason: decoded.error });
    }
    items.push(...decoded.value);
    const url = parseLinkHeader(response.value.link).get('next');
    next =
      url === undefined
        ? undefined
        : {
            method: request.method,
            path: url,
            ...(request.signal !== undefined && { signal: request.signal }),
          };
  }
  return ok({ items, isTruncated: false });
}
