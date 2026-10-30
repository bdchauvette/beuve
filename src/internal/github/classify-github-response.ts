import type { GithubError, GithubValidationDetail } from './github-error.ts';

const rateLimitMessage = /rate limit/i;

export interface ResponseHead {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
}

/**
 * The error for a non-2xx, non-304 response, from its status, headers and parsed body (GitHub's
 * `{ message, errors?, documentation_url }`). 403 and 429 are `rate-limited` when
 * `x-ratelimit-remaining` is 0, a `Retry-After` is present, or the message names a (secondary)
 * rate limit; the reset time comes from `x-ratelimit-reset` or `Retry-After`. 404 and 410 are
 * `not-found` (GitHub also answers 404 for private repositories the token can't see). A
 * `Retry-After` counts from `receivedAt`. Pure.
 */
export function classifyGithubResponse(
  head: ResponseHead,
  body: unknown,
  receivedAt: Temporal.Instant,
): GithubError<never> {
  const message = readMessage(body) ?? `HTTP ${String(head.status)}`;
  switch (head.status) {
    case 401: {
      return { kind: 'unauthorized', message };
    }
    case 403:
    case 429: {
      const resetAt = readResetAt(head.headers, receivedAt);
      const isRateLimited =
        head.status === 429 ||
        head.headers.get('x-ratelimit-remaining') === '0' ||
        head.headers.get('retry-after') !== null ||
        rateLimitMessage.test(message);
      return isRateLimited
        ? { kind: 'rate-limited', message, resetAt }
        : { kind: 'forbidden', message, ssoUrl: readSsoUrl(head.headers) };
    }
    case 404:
    case 410: {
      return { kind: 'not-found', message };
    }
    case 422: {
      return { kind: 'validation-failed', message, errors: readDetails(body) };
    }
    default: {
      return { kind: 'unexpected-status', status: head.status, message };
    }
  }
}

function readMessage(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return typeof body.message === 'string' ? body.message : undefined;
  }
  return undefined;
}

function readResetAt(
  headers: ResponseHead['headers'],
  receivedAt: Temporal.Instant,
): string | undefined {
  const retryAfterSeconds = Number(headers.get('retry-after') ?? NaN);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    const retryAfter = Temporal.Duration.from({
      milliseconds: Math.round(retryAfterSeconds * 1000),
    });
    return receivedAt.add(retryAfter).toString({ fractionalSecondDigits: 3 });
  }
  const resetSeconds = Number(headers.get('x-ratelimit-reset') ?? NaN);
  return Number.isFinite(resetSeconds) && resetSeconds > 0
    ? Temporal.Instant.fromEpochMilliseconds(Math.round(resetSeconds * 1000)).toString({
        fractionalSecondDigits: 3,
      })
    : undefined;
}

function readSsoUrl(headers: ResponseHead['headers']): string | undefined {
  const sso = headers.get('x-github-sso') ?? '';
  const url = sso
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('url='));
  return url?.slice('url='.length);
}

function readDetails(body: unknown): readonly GithubValidationDetail[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('errors' in body) ||
    !Array.isArray(body.errors)
  ) {
    return [];
  }
  return (body.errors as unknown[]).flatMap((entry): GithubValidationDetail[] => {
    if (typeof entry === 'string') {
      return [{ message: entry }];
    }
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const detail: Record<string, string> = {};
    for (const key of ['resource', 'field', 'code', 'message'] as const) {
      const value = record[key];
      if (typeof value === 'string') {
        detail[key] = value;
      }
    }
    return [detail];
  });
}
