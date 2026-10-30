import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GithubRequest } from './github-client.ts';

export interface HttpRequest {
  readonly url: string;
  readonly method: GithubRequest['method'];
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export interface HttpRequestContext {
  /** From `resolveGithubApiBase`, with a trailing slash. */
  readonly base: URL;
  readonly token: string;
  readonly apiVersion: string;
  readonly userAgent: string;
}

/**
 * The URL, headers and body for one API request: `Accept: application/vnd.github+json`, a bearer
 * token, `X-GitHub-Api-Version`, `If-None-Match` for conditional requests. Refuses a path that
 * resolves outside the API root (another origin, or `..` above `/api/v3`), so the token only ever
 * goes to the host it was issued for. Pure.
 */
export function buildGithubHttpRequest(
  request: GithubRequest,
  context: HttpRequestContext,
): Result<HttpRequest, string> {
  const url = resolveUrl(request, context.base);
  if (url === undefined) {
    return err(`not an API URL for ${context.base.host}: ${request.path}`);
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${context.token}`,
    'X-GitHub-Api-Version': context.apiVersion,
    'User-Agent': context.userAgent,
  };
  if (request.etag !== undefined) {
    headers['If-None-Match'] = request.etag;
  }
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return ok({
    url: url.href,
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
}

const absoluteUrl = /^https?:/i;

function resolveUrl(request: GithubRequest, base: URL): URL | undefined {
  const isAbsolute = absoluteUrl.test(request.path);
  if (!isAbsolute && (!request.path.startsWith('/') || request.path.startsWith('//'))) {
    return undefined;
  }
  let url: URL;
  try {
    url = isAbsolute ? new URL(request.path) : new URL(request.path.slice(1), base);
  } catch {
    return undefined;
  }
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(base.pathname) ||
    url.username !== ''
  ) {
    return undefined;
  }
  if (!isAbsolute) {
    const query = Object.entries(request.query ?? {});
    for (const [name, value] of query) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }
  }
  return url;
}
