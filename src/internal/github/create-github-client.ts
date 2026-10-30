import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { buildGithubHttpRequest } from './build-github-http-request.ts';
import type { HttpRequest } from './build-github-http-request.ts';
import { classifyGithubResponse } from './classify-github-response.ts';
import type {
  FetchLike,
  GithubClient,
  GithubRequest,
  GithubResponse,
  TokenSource,
} from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { normalizeHostname } from '#x/net/normalize-hostname.ts';
import { resolveGithubApiBase } from './resolve-github-api-base.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

const invalidJson = Symbol('invalid-json');

export interface GithubClientOptions<E> {
  /** `github.com` or a GitHub Enterprise Server hostname. */
  readonly host: string;
  /** Asked for a token before every request; cache in the source (ADR 0034), not here. */
  readonly getToken: TokenSource<E>;
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /**
   * Replaces the API root `resolveGithubApiBase` gives, for a local fake GitHub in development
   * and tests (ADR 0040). Main passes it only in an unpackaged app, and only a loopback URL.
   */
  readonly apiBase?: URL;
  /** Per request, including reading the body. Defaults to 20 s. */
  readonly timeout?: Temporal.Duration;
  /** Sent as `X-GitHub-Api-Version`. Defaults to `2022-11-28`. */
  readonly apiVersion?: string;
  readonly userAgent?: string;
  /** Gets method, path, status, duration and remaining rate limit; never the token or a query. */
  readonly logger?: Logger;
}

/**
 * A small typed GitHub REST client (ADR 0035): no Octokit, Node's `fetch`, one host. Each request
 * asks `getToken` for a token, sends it once as a bearer header and drops it. 2xx and 304 are
 * successes; other statuses, network failures, timeouts and non-JSON bodies are a
 * {@link GithubError}. It doesn't retry: on `unauthorized` the caller invalidates the credential.
 */
export function createGithubClient<E>(
  options: GithubClientOptions<E>,
): Result<GithubClient<E>, string> {
  const host = normalizeHostname(options.host);
  if (host === undefined) {
    return err(`not a GitHub hostname: ${options.host}`);
  }
  const base = options.apiBase ?? resolveGithubApiBase(host);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeout = options.timeout ?? Temporal.Duration.from({ seconds: 20 });

  const send = async (request: GithubRequest): Promise<Result<GithubResponse, GithubError<E>>> => {
    const token = await options.getToken(host);
    if (!token.ok) {
      return err({ kind: 'credentials', error: token.error });
    }
    const built = buildGithubHttpRequest(request, {
      base,
      token: token.value.reveal(),
      apiVersion: options.apiVersion ?? '2022-11-28',
      userAgent: options.userAgent ?? 'beuve',
    });
    if (!built.ok) {
      return err({ kind: 'invalid-request', reason: built.error });
    }
    const stopwatch = new Stopwatch();
    const response = await exchange(built.value, fetchImpl, timeout, request.signal);
    options.logger?.debug('github: request', {
      method: request.method,
      path: new URL(built.value.url).pathname,
      status: response.ok ? response.value.status : response.error.kind,
      duration: stopwatch.elapsed(),
      rateLimitRemaining: response.ok ? response.value.rateLimitRemaining : undefined,
    });
    if (!response.ok) {
      return response;
    }
    const { status, headers, text } = response.value;
    if (status === 304) {
      return ok({
        status,
        body: undefined,
        etag: headers.get('etag') ?? undefined,
        link: undefined,
      });
    }
    const body = parseBody(text);
    if (status < 200 || status > 299) {
      return err(
        classifyGithubResponse(
          { status, headers },
          body === invalidJson ? undefined : body,
          Temporal.Now.instant(),
        ),
      );
    }
    if (body === invalidJson) {
      return err({ kind: 'unexpected-shape', reason: 'the response is not JSON' });
    }
    return ok({
      status,
      body,
      etag: headers.get('etag') ?? undefined,
      link: headers.get('link') ?? undefined,
    });
  };

  return ok({ host, send });
}

interface Exchange {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly rateLimitRemaining: string | undefined;
}

async function exchange(
  request: HttpRequest,
  fetchImpl: FetchLike,
  timeout: Temporal.Duration,
  signal: AbortSignal | undefined,
): Promise<Result<Exchange, GithubError<never>>> {
  const timeoutSignal = AbortSignal.timeout(timeout.total('milliseconds'));
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined && { body: request.body }),
      // Renamed repositories answer 301; fetch drops Authorization on a cross-origin redirect.
      redirect: 'follow',
      signal: signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal]),
    });
    const text = await response.text();
    return ok({
      status: response.status,
      headers: response.headers,
      text,
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining') ?? undefined,
    });
  } catch (error: unknown) {
    if (timeoutSignal.aborted) {
      return err({ kind: 'timeout', timeout });
    }
    return err({
      kind: 'network',
      message: Error.isError(error) ? error.message : String(error),
    });
  }
}

function parseBody(text: string): unknown {
  if (text.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalidJson;
  }
}
