import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fromPromise } from '#pkg/result/from-promise.ts';
import type { Result } from '#pkg/result/result.ts';

const fileName = 'mcp-token';
const tokenPattern = /^[\w-]{43,}$/u;

/**
 * Returns the MCP bearer token stored in `directory`, creating a random 256-bit one on first
 * use. The file is owner-only (0600) so other local users can't read it.
 */
export async function loadMcpToken(directory: string): Promise<Result<string, Error>> {
  return fromPromise(readOrCreate(path.join(directory, fileName)), toError);
}

async function readOrCreate(file: string): Promise<string> {
  const existing = await readExisting(file);
  if (existing !== undefined) {
    await chmod(file, 0o600);
    return existing;
  }
  const token = randomBytes(32).toString('base64url');
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return token;
}

async function readExisting(file: string): Promise<string | undefined> {
  try {
    const contents = await readFile(file, 'utf8');
    const token = contents.trim();
    return tokenPattern.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
