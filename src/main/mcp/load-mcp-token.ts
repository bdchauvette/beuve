import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { errorFrom } from '#x/error/error-from.ts';
import { writeFileAtomic } from '#x/fs/write-file-atomic.ts';
import { fromPromise } from '#x/result/from-promise.ts';
import type { Result } from '#x/result/result.ts';

const fileName = 'mcp-token';
const tokenPattern = /^[\w-]{43,}$/u;

/**
 * Returns the MCP bearer token stored in `directory`, creating a random 256-bit one on first
 * use (or in place of a malformed one). The file is created owner-only (0600) so other local
 * users can't read it; an older install's looser file is tightened at startup with the rest of
 * `userData` (ADR 0082).
 */
export async function loadMcpToken(directory: string): Promise<Result<string, Error>> {
  return fromPromise(readOrCreate(path.join(directory, fileName)), errorFrom);
}

async function readOrCreate(file: string): Promise<string> {
  const existing = await readExisting(file);
  if (existing !== undefined) {
    return existing;
  }
  const token = randomBytes(32).toBase64({ alphabet: 'base64url', omitPadding: true });
  await writeFileAtomic(file, `${token}\n`, { mode: 0o600 });
  return token;
}

async function readExisting(file: string): Promise<string | undefined> {
  try {
    const contents = await readFile(file, 'utf8');
    const token = contents.trim();
    if (tokenPattern.test(token)) {
      return token;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
