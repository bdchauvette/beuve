import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fromPromise } from '#x/result/from-promise.ts';
import type { Result } from '#x/result/result.ts';

/** Contents of `<userData>/mcp-server.json`, read by agents and CLIs to find the server. */
export interface McpDiscovery {
  readonly schemaVersion: 1;
  readonly name: 'beuve';
  readonly transport: 'streamable-http';
  readonly url: string;
  readonly token: string;
  readonly pid: number;
  readonly startedAt: string;
}

/** Removes the discovery file again; safe to call more than once. */
export type RemoveMcpDiscovery = () => Promise<void>;

const fileName = 'mcp-server.json';

/**
 * Atomically writes the owner-only (0600) discovery file into `directory` and returns a
 * function that deletes it when the server stops.
 */
export async function writeMcpDiscovery(
  directory: string,
  discovery: McpDiscovery,
): Promise<Result<RemoveMcpDiscovery, Error>> {
  const file = path.join(directory, fileName);
  return fromPromise(write(file, discovery), errorFrom);
}

async function write(file: string, discovery: McpDiscovery): Promise<RemoveMcpDiscovery> {
  const temporary = `${file}.${String(discovery.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(discovery, undefined, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  return async (): Promise<void> => rm(file, { force: true });
}

function errorFrom(cause: unknown): Error {
  return Error.isError(cause) ? cause : new Error(String(cause));
}
