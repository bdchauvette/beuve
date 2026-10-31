import { createHash, timingSafeEqual } from 'node:crypto';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

const bearerPattern = /^Bearer\s+(\S+)$/iu;

export interface McpRequestHeaders {
  readonly host?: string | undefined;
  readonly origin?: string | undefined;
  readonly authorization?: string | undefined;
}

export interface McpRequestRejection {
  readonly status: 401 | 403;
  readonly reason: string;
}

/**
 * Admits a request only if it targets the loopback server by name (DNS-rebinding defence), comes
 * from no browser origin other than the server's own, and carries the bearer token.
 */
export function checkMcpRequest(
  headers: McpRequestHeaders,
  expected: { readonly port: number; readonly token: string },
): Result<undefined, McpRequestRejection> {
  const hosts = [`127.0.0.1:${String(expected.port)}`, `localhost:${String(expected.port)}`];
  if (headers.host === undefined || !hosts.includes(headers.host.toLowerCase())) {
    return err({ status: 403, reason: 'host not allowed' });
  }
  const origin = headers.origin?.toLowerCase();
  if (origin !== undefined && hosts.every((host) => origin !== `http://${host}`)) {
    return err({ status: 403, reason: 'origin not allowed' });
  }
  const presented = bearerPattern.exec(headers.authorization ?? '')?.[1];
  if (presented !== undefined && isSameSecret(presented, expected.token)) {
    return ok(undefined);
  }
  return err({ status: 401, reason: 'missing or invalid bearer token' });
}

function isSameSecret(presented: string, token: string): boolean {
  return timingSafeEqual(digest(presented), digest(token));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
