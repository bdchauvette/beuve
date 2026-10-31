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

/** The loopback port the server listens on, and the bearer token it hands out. */
export interface McpServerSecret {
  readonly port: number;
  readonly token: string;
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
  expected: McpServerSecret,
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

/** Compares in constant time, whatever the lengths. */
function isSameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
