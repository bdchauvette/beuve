import type { Result } from '#pkg/result/result.ts';

import type { AuthError } from './auth-error.ts';
import type { GithubToken } from './github-token.ts';

/**
 * The port through which beuve obtains GitHub credentials (ADR 0034). The first adapter reuses the
 * GitHub CLI's login (`createGhCliCredentialProvider`); an OAuth device flow with the Keychain, or a
 * personal access token, fit the same shape. Providers never reject, never persist a token and never
 * log one.
 */
export interface GithubCredentialProvider {
  /** A token for `host` (`github.com` or a GitHub Enterprise Server hostname). */
  readonly getToken: (request: CredentialRequest) => Promise<Result<GithubToken, AuthError>>;
  /**
   * Forget any cached token for `host`, e.g. after GitHub answered 401. With `token`, only that
   * token is forgotten, so a late 401 for an old token doesn't evict a fresh one.
   */
  readonly invalidate: (request: InvalidateRequest) => void;
  /** Who the credential belongs to, for the UI. Carries no secret. */
  readonly describe: (
    request: CredentialRequest,
  ) => Promise<Result<CredentialDescription, AuthError>>;
}

export interface CredentialRequest {
  readonly host: string;
}

export interface InvalidateRequest {
  readonly host: string;
  readonly token?: GithubToken;
}

export interface CredentialDescription {
  /** The mechanism, so the UI can say "via GitHub CLI" and suggest the right remedy. */
  readonly provider: 'gh-cli';
  readonly host: string;
  /** Unknown when the mechanism can't say (e.g. a `gh` too old for `auth status --json`). */
  readonly account: CredentialAccount | undefined;
}

export interface CredentialAccount {
  readonly login: string;
  /** OAuth scopes; absent for fine-grained tokens and when the provider can't tell. */
  readonly scopes: readonly string[] | undefined;
  /** Whether the provider last confirmed the credential works, and why not. */
  readonly check:
    { readonly kind: 'valid' } | { readonly kind: 'failed'; readonly message: string };
}
