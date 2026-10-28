import type { Result } from '#pkg/result/result.ts';

import type { AuthError } from './auth-error.ts';
import type {
  CredentialRequest,
  GithubCredentialProvider,
  InvalidateRequest,
} from './github-credential-provider.ts';
import type { GithubToken } from './github-token.ts';

export interface CachedCredentialProviderOptions {
  /** How long a token is reused before the inner provider is asked again. Defaults to 5 minutes. */
  readonly ttlMs?: number;
  /** Milliseconds since the epoch, injectable for tests. */
  readonly now?: () => number;
}

interface Entry {
  readonly pending: Promise<Result<GithubToken, AuthError>>;
  readonly expiresAt: number;
  token?: GithubToken;
}

/**
 * Keeps each host's token in memory for a short TTL (ADR 0034), so a burst of API calls runs the
 * inner provider once. Concurrent requests share one lookup; failures are not cached; `invalidate`
 * (after a 401) drops the host's token, or only the given one. `describe` is passed through.
 */
export function createCachedCredentialProvider(
  inner: GithubCredentialProvider,
  options: CachedCredentialProviderOptions = {},
): GithubCredentialProvider {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  const getToken = async (request: CredentialRequest): Promise<Result<GithubToken, AuthError>> => {
    const key = request.host.toLowerCase();
    const cached = entries.get(key);
    if (cached !== undefined && now() < cached.expiresAt) {
      return cached.pending;
    }
    const entry: Entry = { pending: inner.getToken(request), expiresAt: now() + ttlMs };
    entries.set(key, entry);
    const result = await entry.pending;
    if (result.ok) {
      entry.token = result.value;
    } else if (entries.get(key) === entry) {
      entries.delete(key);
    }
    return result;
  };

  const invalidate = (request: InvalidateRequest): void => {
    const key = request.host.toLowerCase();
    const cached = entries.get(key);
    if (cached === undefined) {
      return;
    }
    if (
      request.token === undefined ||
      cached.token === undefined ||
      cached.token === request.token
    ) {
      entries.delete(key);
    }
    inner.invalidate(request);
  };

  return { getToken, invalidate, describe: inner.describe };
}
