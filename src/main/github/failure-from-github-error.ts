import type { GithubFailureView } from '#contract/ipc-contract.ts';
import type { AuthError } from '#internal/auth/auth-error.ts';
import type { GithubError } from '#internal/github/github-error.ts';
import type { PostReviewError } from '#internal/github/post-pull-request-review.ts';

import { formatDuration } from '#x/time/format-duration.ts';

import { describeAuthError } from './describe-auth-error.ts';
import { githubFailure } from './github-failure.ts';

/**
 * What the UI says when a GitHub call fails. Messages are GitHub's or the credential provider's
 * and never carry a token; the login errors keep their `gh auth login` remedy. Pure.
 */
export function failureFromGithubError(
  error: GithubError<AuthError> | PostReviewError<AuthError>,
  subject: string,
  locale?: Intl.LocalesArgument,
): GithubFailureView {
  switch (error.kind) {
    case 'credentials': {
      const auth = error.error;
      return githubFailure(
        'not-signed-in',
        describeAuthError(auth, locale),
        'remedy' in auth ? auth.remedy : undefined,
      );
    }
    case 'unauthorized': {
      return githubFailure(
        'not-signed-in',
        `GitHub rejected the credential: ${error.message}`,
        'gh auth refresh',
      );
    }
    case 'forbidden': {
      return githubFailure(
        'forbidden',
        error.ssoUrl === undefined
          ? `GitHub refused access to ${subject}: ${error.message}`
          : `Authorize your token for this organization (SAML) at ${error.ssoUrl}`,
      );
    }
    case 'rate-limited': {
      return githubFailure(
        'rate-limited',
        error.resetAt === undefined
          ? 'GitHub rate limit reached; try again later.'
          : `GitHub rate limit reached until ${error.resetAt}.`,
      );
    }
    case 'not-found': {
      return githubFailure(
        'not-found',
        `${subject} was not found, or your GitHub account can't see it.`,
      );
    }
    case 'cannot-review-own-pull-request': {
      return githubFailure(
        'own-pull-request',
        'GitHub does not let you approve or request changes on your own pull request.',
      );
    }
    case 'stale-commit': {
      return githubFailure(
        'stale-commit',
        'The pull request moved on GitHub since this review was written. Reload it and post again.',
      );
    }
    case 'comments-rejected':
    case 'validation-failed': {
      const messages = error.kind === 'validation-failed' ? [error.message] : error.messages;
      return githubFailure('github-failed', `GitHub refused the review: ${messages.join('; ')}`);
    }
    case 'unexpected-status':
    case 'network':
    case 'timeout':
    case 'invalid-request':
    case 'unexpected-shape': {
      return githubFailure(
        'github-failed',
        `GitHub request failed: ${describeTransport(error, locale)}`,
      );
    }
  }
}

function describeTransport(
  error: Extract<
    GithubError<AuthError>,
    { kind: 'unexpected-status' | 'network' | 'timeout' | 'invalid-request' | 'unexpected-shape' }
  >,
  locale: Intl.LocalesArgument | undefined,
): string {
  switch (error.kind) {
    case 'unexpected-status': {
      return `HTTP ${String(error.status)} ${error.message}`;
    }
    case 'network': {
      return error.message;
    }
    case 'timeout': {
      return `no answer within ${formatDuration(error.timeout, locale)}`;
    }
    case 'invalid-request': {
      return error.reason;
    }
    case 'unexpected-shape': {
      return `unexpected response (${error.reason})`;
    }
  }
}
