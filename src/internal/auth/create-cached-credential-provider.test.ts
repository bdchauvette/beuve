import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AuthError } from './auth-error.ts';
import { createCachedCredentialProvider } from './create-cached-credential-provider.ts';
import type { GithubCredentialProvider } from './github-credential-provider.ts';
import { GithubToken } from './github-token.ts';

interface Inner extends GithubCredentialProvider {
  readonly calls: string[];
  failNext: boolean;
}

function inner(): Inner {
  let issued = 0;
  const provider: Inner = {
    calls: [],
    failNext: false,
    getToken: async ({ host }): Promise<Result<GithubToken, AuthError>> => {
      provider.calls.push(host);
      await Promise.resolve();
      if (provider.failNext) {
        provider.failNext = false;
        return err({ kind: 'timeout', timeoutMs: 1 });
      }
      issued += 1;
      const token = GithubToken.parse(`gho_token${String(issued)}`);
      return token === undefined ? err({ kind: 'timeout', timeoutMs: 1 }) : ok(token);
    },
    invalidate: (): void => {
      // The fake caches nothing.
    },
    describe: async ({ host }) => {
      await Promise.resolve();
      return ok({ provider: 'gh-cli' as const, host, account: undefined });
    },
  };
  return provider;
}

async function reveal(provider: GithubCredentialProvider, host = 'github.com'): Promise<string> {
  const result = await provider.getToken({ host });
  return result.ok ? result.value.reveal() : result.error.kind;
}

describe('createCachedCredentialProvider', () => {
  it('reuses a token until the TTL passes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'], now: 0 });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const source = inner();
    const cached = createCachedCredentialProvider(source, { ttlMs: 1000 });
    expect(await reveal(cached)).toBe('gho_token1');
    vi.setSystemTime(999);
    expect(await reveal(cached, 'GITHUB.com')).toBe('gho_token1');
    vi.setSystemTime(1000);
    expect(await reveal(cached)).toBe('gho_token2');
    expect(source.calls).toHaveLength(2);
  });

  it('shares one lookup between concurrent callers', async () => {
    const source = inner();
    const cached = createCachedCredentialProvider(source);
    const tokens = await Promise.all([reveal(cached), reveal(cached), reveal(cached)]);
    expect(tokens).toEqual(['gho_token1', 'gho_token1', 'gho_token1']);
    expect(source.calls).toHaveLength(1);
  });

  it('does not cache failures', async () => {
    const source = inner();
    source.failNext = true;
    const cached = createCachedCredentialProvider(source);
    expect(await reveal(cached)).toBe('timeout');
    expect(await reveal(cached)).toBe('gho_token1');
  });

  it('keeps hosts apart', async () => {
    const cached = createCachedCredentialProvider(inner());
    expect(await reveal(cached, 'github.com')).toBe('gho_token1');
    expect(await reveal(cached, 'ghe.example.com')).toBe('gho_token2');
    expect(await reveal(cached, 'github.com')).toBe('gho_token1');
  });

  it('forgets a token on invalidate, but not for a stale token', async () => {
    const source = inner();
    const cached = createCachedCredentialProvider(source);
    const first = await cached.getToken({ host: 'github.com' });
    cached.invalidate({ host: 'github.com' });
    expect(await reveal(cached)).toBe('gho_token2');
    if (first.ok) {
      cached.invalidate({ host: 'github.com', token: first.value });
    }
    expect(await reveal(cached)).toBe('gho_token2');
  });
});
