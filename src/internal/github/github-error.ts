/** One entry of a 422's `errors`, which GitHub sends as objects or as bare strings. */
export interface GithubValidationDetail {
  readonly resource?: string;
  readonly field?: string;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Why a GitHub API call failed (ADR 0035). `E` is the credential source's own error, passed
 * through untouched. On `unauthorized` the caller should invalidate the cached token and may retry
 * once. Messages are GitHub's and carry no token.
 */
export type GithubError<E> =
  | { readonly kind: 'credentials'; readonly error: E }
  | { readonly kind: 'unauthorized'; readonly message: string }
  | {
      readonly kind: 'forbidden';
      readonly message: string;
      /** From `X-GitHub-SSO`: where to authorize the token for an organization using SAML. */
      readonly ssoUrl: string | undefined;
    }
  | {
      readonly kind: 'rate-limited';
      readonly message: string;
      /** ISO-8601 time the limit resets (primary limit, or now + `Retry-After`). */
      readonly resetAt: string | undefined;
    }
  | { readonly kind: 'not-found'; readonly message: string }
  | {
      readonly kind: 'validation-failed';
      readonly message: string;
      readonly errors: readonly GithubValidationDetail[];
    }
  | { readonly kind: 'unexpected-status'; readonly status: number; readonly message: string }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'timeout'; readonly timeout: Temporal.Duration }
  | { readonly kind: 'invalid-request'; readonly reason: string }
  | { readonly kind: 'unexpected-shape'; readonly reason: string };
