import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { okValueFrom } from '#testing/ok-value-from.ts';
import type { LogFields } from '#x/log/create-logger.ts';
import { ok } from '#x/result/ok.ts';

import { createGithubClient } from './create-github-client.ts';

describe('createGithubClient', () => {
  test('refuses a host that is not a hostname', ({ expect }) => {
    const created = createGithubClient({
      host: 'https://github.com',
      getToken: async () => settle(ok({ reveal: (): string => 'unused' })),
    });
    expect(created.ok).toBe(false);
  });

  test('sends the token only as a bearer header and returns body, ETag and Link', async ({
    expect,
    fakeGithub,
  }) => {
    const { client, requests } = fakeGithub(() => ({
      status: 200,
      body: { a: 1 },
      headers: { etag: '"e1"', link: '<https://api.github.com/x?page=2>; rel="next"' },
    }));
    const response = await client.send({ method: 'GET', path: '/x' });
    expect(response).toStrictEqual(
      ok({
        status: 200,
        body: { a: 1 },
        etag: '"e1"',
        link: '<https://api.github.com/x?page=2>; rel="next"',
      }),
    );
    expect(requests[0]?.headers['Authorization']).toBe('Bearer gho_testtoken');
    expect(requests[0]?.url).toBe('https://api.github.com/x');
  });

  test('passes credential failures through untouched, without a request', async ({
    expect,
    fakeGithub,
  }) => {
    const { client, requests } = fakeGithub(() => ({ status: 200 }), { token: undefined });
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'credentials', error: 'no-token' },
    });
    expect(requests).toStrictEqual([]);
  });

  test('returns 304 as a success without a body', async ({ expect, fakeGithub }) => {
    const { client, requests } = fakeGithub(() => ({
      status: 304,
      headers: { etag: '"e1"' },
    }));
    const response = await client.send({ method: 'GET', path: '/x', etag: '"e1"' });
    expect(response).toStrictEqual(
      ok({ status: 304, body: undefined, etag: '"e1"', link: undefined }),
    );
    expect(requests[0]?.headers['If-None-Match']).toBe('"e1"');
  });

  test('classifies error statuses', async ({ expect, fakeGithub }) => {
    const { client } = fakeGithub(() => ({
      status: 401,
      body: { message: 'Bad credentials' },
    }));
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unauthorized', message: 'Bad credentials' },
    });
  });

  test('reports a 200 that is not JSON as unexpected-shape', async ({ expect, fakeGithub }) => {
    const { client } = fakeGithub(() => ({ status: 200, body: '<html>proxy login</html>' }));
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });

  test('reports network failures and timeouts', async ({ expect, fakeGithub }) => {
    const { client } = fakeGithub(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'network', message: 'fetch failed' },
    });

    const slow = createGithubClient({
      host: 'github.com',
      getToken: async () => settle(ok({ reveal: (): string => 't' })),
      timeout: Temporal.Duration.from({ milliseconds: 50 }),
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'TimeoutError'));
          });
        }),
    });
    await expect(okValueFrom(slow).send({ method: 'GET', path: '/x' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 50 }) },
    });
  });

  test('never logs the token or the query', async ({ expect }) => {
    const logged: LogFields[] = [];
    const created = createGithubClient({
      host: 'github.com',
      getToken: async () => settle(ok({ reveal: (): string => 'gho_secretvalue' })),
      fetch: async () => settle(new Response('{}', { status: 200 })),
      logger: {
        debug: (_message, fields = {}) => {
          logged.push(fields);
        },
        info: ignore,
        warn: ignore,
        error: ignore,
      },
    });
    await okValueFrom(created).send({ method: 'GET', path: '/search', query: { q: 'private' } });
    expect(JSON.stringify(logged)).not.toMatch(/gho_secretvalue|private/);
    expect(logged[0]).toMatchObject({ method: 'GET', path: '/search', status: 200 });
  });
});

async function settle<T>(value: T): Promise<T> {
  await Promise.resolve();
  return value;
}

function ignore(): void {
  // Only debug lines are under test.
}
