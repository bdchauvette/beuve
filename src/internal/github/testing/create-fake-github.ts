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
  const configured = configuredToken(options);
  const created = createGithubClient<'no-token'>({
    host: options.host ?? 'github.com',
    getToken: async () => {
      await Promise.resolve();
      if (configured === undefined) {
        return err('no-token');
      }
      return ok({ reveal: (): string => configured });
    },
    fetch: async (url, init) => {
      await Promise.resolve();
      const recorded: RecordedRequest = {
        url,
        method: init.method ?? 'GET',
        headers: { ...(init.headers as Record<string, string>) },
        body: parsedBodyOf(init),
      };
      requests.push(recorded);
      const response = respond(recorded, requests.length - 1);
      return new Response(responseText(response), {
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

/** The token the client gets: the configured one, `undefined` for none, or a default. */
function configuredToken(options: FakeGithubOptions): string | undefined {
  if ('token' in options) {
    return options.token;
  }
  return 'gho_testtoken';
}

function parsedBodyOf(init: RequestInit): unknown {
  if (typeof init.body === 'string') {
    return JSON.parse(init.body) as unknown;
  }
  return undefined;
}

function responseText(response: FakeResponse): string | undefined {
  if (response.body === undefined) {
    return undefined;
  }
  if (typeof response.body === 'string') {
    return response.body;
  }
  return JSON.stringify(response.body);
}
