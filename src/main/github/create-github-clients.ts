import type { AuthError } from '#internal/auth/auth-error.ts';
import type { GithubCredentialProvider } from '#internal/auth/github-credential-provider.ts';
import type { GithubToken } from '#internal/auth/github-token.ts';
import { createGithubClient } from '#internal/github/create-github-client.ts';
import type { FetchLike, GithubClient } from '#internal/github/github-client.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

/** GitHub REST clients, one per host, sharing one cached credential provider (ADR 0034, 0035). */
export interface GithubClients {
  readonly credentials: GithubCredentialProvider;
  /**
   * Runs `call` with the host's client. On `unauthorized` the token that was used is invalidated
   * and `call` runs once more with a fresh one (the user may have re-run `gh auth login`).
   */
  readonly withClient: <T, F extends { readonly kind: string }>(
    host: string,
    call: (client: GithubClient<AuthError>) => Promise<Result<T, F>>,
  ) => Promise<Result<T, F | { readonly kind: 'invalid-request'; readonly reason: string }>>;
}

export interface GithubClientsOptions {
  /** Already cached (`createCachedCredentialProvider`); asked before every request. */
  readonly credentials: GithubCredentialProvider;
  readonly fetch?: FetchLike;
  /** A development-only API root for every host (ADR 0040); never set in a packaged app. */
  readonly apiBase?: URL;
  readonly logger: Logger;
}

/**
 * Builds a client per call, so each call knows which token it sent: a 401 then invalidates that
 * token only, and a concurrent call's fresh token survives (ADR 0034).
 */
export function createGithubClients(options: GithubClientsOptions): GithubClients {
  const clientFor = (
    host: string,
    used: { token: GithubToken | undefined },
  ): Result<GithubClient<AuthError>, string> =>
    createGithubClient<AuthError>({
      host,
      getToken: async (forHost) => {
        const token = await options.credentials.getToken({ host: forHost });
        if (token.ok) {
          used.token = token.value;
        }
        return token;
      },
      ...(options.fetch !== undefined && { fetch: options.fetch }),
      ...(options.apiBase !== undefined && { apiBase: options.apiBase }),
      logger: options.logger,
    });

  return {
    credentials: options.credentials,
    withClient: async <T, F extends { readonly kind: string }>(
      host: string,
      call: (client: GithubClient<AuthError>) => Promise<Result<T, F>>,
    ): Promise<Result<T, F | { readonly kind: 'invalid-request'; readonly reason: string }>> => {
      const used: { token: GithubToken | undefined } = { token: undefined };
      const client = clientFor(host, used);
      if (!client.ok) {
        return err({ kind: 'invalid-request', reason: client.error });
      }
      const first = await call(client.value);
      if (first.ok || first.error.kind !== 'unauthorized') {
        return first;
      }
      options.credentials.invalidate({
        host: client.value.host,
        ...(used.token !== undefined && { token: used.token }),
      });
      options.logger.info('github: credential rejected; retrying once with a fresh one', { host });
      return call(client.value);
    },
  };
}
