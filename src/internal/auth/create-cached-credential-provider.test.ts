import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AuthError } from './auth-error.ts';
import { createCachedCredentialProvider } from './create-cached-credential-provider.ts';
import type { GithubCredentialProvider } from './github-credential-provider.ts';
import { GithubToken } from './github-token.ts';
import { test } from './testing/test.ts';

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
        return err({ kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 1 }) });
      }
      issued += 1;
      const parsed = GithubToken.parse(`gho_token${String(issued)}`);
      if (parsed === undefined) {
        return err({ kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 1 }) });
      }
      return ok(parsed);
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
  if (result.ok) {
    return result.value.reveal();
  }
  return result.error.kind;
}

describe('createCachedCredentialProvider', () => {
  test('reuses a token until the TTL passes', { concurrent: false }, async ({ expect, clock }) => {
    const source = inner();
    const cached = createCachedCredentialProvider(source, {
      ttl: Temporal.Duration.from({ seconds: 1 }),
    });
    await expect(reveal(cached)).resolves.toBe('gho_token1');
    clock.advance({ milliseconds: 999 });
    await expect(reveal(cached, 'GITHUB.com')).resolves.toBe('gho_token1');
    clock.advance({ milliseconds: 1 });
    await expect(reveal(cached)).resolves.toBe('gho_token2');
    expect(source.calls).toHaveLength(2);
  });

  test('shares one lookup between concurrent callers', async ({ expect }) => {
    const source = inner();
    const cached = createCachedCredentialProvider(source);
    const tokens = await Promise.all([reveal(cached), reveal(cached), reveal(cached)]);
    expect(tokens).toStrictEqual(['gho_token1', 'gho_token1', 'gho_token1']);
    expect(source.calls).toHaveLength(1);
  });

  test('does not cache failures', async ({ expect }) => {
    const source = inner();
    source.failNext = true;
    const cached = createCachedCredentialProvider(source);
    await expect(reveal(cached)).resolves.toBe('timeout');
    await expect(reveal(cached)).resolves.toBe('gho_token1');
  });

  test('keeps hosts apart', async ({ expect }) => {
    const cached = createCachedCredentialProvider(inner());
    await expect(reveal(cached, 'github.com')).resolves.toBe('gho_token1');
    await expect(reveal(cached, 'ghe.example.com')).resolves.toBe('gho_token2');
    await expect(reveal(cached, 'github.com')).resolves.toBe('gho_token1');
  });

  test('forgets a token on invalidate, but not for a stale token', async ({ expect }) => {
    const source = inner();
    const cached = createCachedCredentialProvider(source);
    const first = await cached.getToken({ host: 'github.com' });
    cached.invalidate({ host: 'github.com' });
    await expect(reveal(cached)).resolves.toBe('gho_token2');
    cached.invalidate({ host: 'github.com', token: okValueFrom(first) });
    await expect(reveal(cached)).resolves.toBe('gho_token2');
  });
});
