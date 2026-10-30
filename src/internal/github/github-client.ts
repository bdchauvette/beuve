import type { Result } from '#x/result/result.ts';

import type { GithubError } from './github-error.ts';

/** Anything with a `reveal()`, such as the auth domain's `GithubToken` (ADR 0030 structural port). */
export interface RevealableToken {
  reveal(): string;
}

/** Supplies a token for `host` when a request is about to be sent; never stored by the client. */
export type TokenSource<E> = (host: string) => Promise<Result<RevealableToken, E>>;

/** The subset of `fetch` the client uses, injectable for tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type QueryValue = string | number | boolean | undefined;

export interface GithubRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /**
   * A path below the API root built with `githubPath` (`/repos/o/r/pulls/1`), or an absolute URL on
   * the API origin (a `Link: rel="next"` URL). Anything else is refused, so a token can't leak.
   */
  readonly path: string;
  /** Ignored for absolute URLs, which carry their own query. */
  readonly query?: Readonly<Record<string, QueryValue>>;
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Sent as `If-None-Match`; a 304 then comes back as `status: 304` with no body. */
  readonly etag?: string;
  readonly signal?: AbortSignal | undefined;
}

export interface GithubResponse {
  /** A 2xx status, or 304 for a conditional request whose resource didn't change. */
  readonly status: number;
  /** Parsed JSON, `undefined` when there was none. */
  readonly body: unknown;
  readonly etag: string | undefined;
  readonly link: string | undefined;
}

/** A REST client bound to one GitHub host (ADR 0035). `send` never rejects. */
export interface GithubClient<E> {
  readonly host: string;
  readonly send: (request: GithubRequest) => Promise<Result<GithubResponse, GithubError<E>>>;
}
