import { describe, expect, it } from 'vitest';

import type { LogFields } from '#x/log/create-logger.ts';
import { ok } from '#x/result/ok.ts';

import { createGithubClient } from './create-github-client.ts';
import { createFakeGithub } from './testing/create-fake-github.ts';

const secrets = /gho_secretvalue|private/;

describe('createGithubClient', () => {
  it('refuses a host that is not a hostname', () => {
    const created = createGithubClient({
      host: 'https://github.com',
      getToken: async () => settle(ok({ reveal: (): string => 'unused' })),
    });
    expect(created.ok).toBe(false);
  });

  it('sends the token only as a bearer header and returns body, ETag and Link', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 200,
      body: { a: 1 },
      headers: { etag: '"e1"', link: '<https://api.github.com/x?page=2>; rel="next"' },
    }));
    const response = await client.send({ method: 'GET', path: '/x' });
    expect(response).toEqual(
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

  it('passes credential failures through untouched, without a request', async () => {
    const { client, requests } = createFakeGithub(() => ({ status: 200 }), { token: undefined });
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toEqual({
      ok: false,
      error: { kind: 'credentials', error: 'no-token' },
    });
    expect(requests).toEqual([]);
  });

  it('returns 304 as a success without a body', async () => {
    const { client, requests } = createFakeGithub(() => ({
      status: 304,
      headers: { etag: '"e1"' },
    }));
    const response = await client.send({ method: 'GET', path: '/x', etag: '"e1"' });
    expect(response).toEqual(ok({ status: 304, body: undefined, etag: '"e1"', link: undefined }));
    expect(requests[0]?.headers['If-None-Match']).toBe('"e1"');
  });

  it('classifies error statuses', async () => {
    const { client } = createFakeGithub(() => ({
      status: 401,
      body: { message: 'Bad credentials' },
    }));
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toEqual({
      ok: false,
      error: { kind: 'unauthorized', message: 'Bad credentials' },
    });
  });

  it('reports a 200 that is not JSON as unexpected-shape', async () => {
    const { client } = createFakeGithub(() => ({ status: 200, body: '<html>proxy login</html>' }));
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });

  it('reports network failures and timeouts', async () => {
    const { client } = createFakeGithub(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client.send({ method: 'GET', path: '/x' })).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'fetch failed' },
    });

    const slow = createGithubClient({
      host: 'github.com',
      getToken: async () => settle(ok({ reveal: (): string => 't' })),
      timeoutMs: 50,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'TimeoutError'));
          });
        }),
    });
    expect(slow.ok).toBe(true);
    if (slow.ok) {
      await expect(slow.value.send({ method: 'GET', path: '/x' })).resolves.toEqual({
        ok: false,
        error: { kind: 'timeout', timeoutMs: 50 },
      });
    }
  });

  it('never logs the token or the query', async () => {
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
    if (created.ok) {
      await created.value.send({ method: 'GET', path: '/search', query: { q: 'private' } });
    }
    expect(JSON.stringify(logged)).not.toMatch(secrets);
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
