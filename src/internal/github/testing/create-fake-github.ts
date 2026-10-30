import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { createGithubClient } from '../create-github-client.ts';
import type { GithubClient } from '../github-client.ts';

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface FakeResponse {
  readonly status: number;
  /** Serialized as JSON unless it is already a string. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface FakeGithub {
  readonly client: GithubClient<'no-token'>;
  readonly requests: RecordedRequest[];
}

export interface FakeGithubOptions {
  readonly host?: string;
  /** `undefined` makes the token source fail with `'no-token'`. */
  readonly token?: string | undefined;
}

/**
 * A {@link GithubClient} over a scripted `fetch`: `respond` answers each request (a thrown error
 * stands for a network failure) and every request is recorded with its headers and parsed body.
 * Never touches the network.
 */
export function createFakeGithub(
  respond: (request: RecordedRequest, index: number) => FakeResponse,
  options: FakeGithubOptions = {},
): FakeGithub {
  const requests: RecordedRequest[] = [];
  const token = 'token' in options ? options.token : 'gho_testtoken';
  const created = createGithubClient<'no-token'>({
    host: options.host ?? 'github.com',
    getToken: async () => {
      await Promise.resolve();
      return token === undefined ? err('no-token') : ok({ reveal: (): string => token });
    },
    fetch: async (url, init) => {
      await Promise.resolve();
      const recorded: RecordedRequest = {
        url,
        method: init.method ?? 'GET',
        headers: { ...(init.headers as Record<string, string>) },
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      requests.push(recorded);
      const response = respond(recorded, requests.length - 1);
      const text =
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      return new Response(response.body === undefined ? undefined : text, {
        status: response.status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...response.headers },
      });
    },
  });
  if (!created.ok) {
    throw new Error(created.error);
  }
  return { client: created.value, requests };
}
