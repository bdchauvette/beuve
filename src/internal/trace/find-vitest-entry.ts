import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { TraceError } from './trace-error.ts';

export interface VitestEntry {
  /** The CLI script to run with Node (real path). */
  readonly script: string;
  readonly version: string;
}

/**
 * Locates Vitest's CLI script in `<dependencyRoot>/node_modules/vitest` from its package's `bin`
 * field, without a shell or `node_modules/.bin` shims, so the script is run with a Node binary
 * beuve chose (ADR 0036).
 */
export async function findVitestEntry(
  dependencyRoot: string,
): Promise<Result<VitestEntry, TraceError>> {
  const packageDirectory = path.join(dependencyRoot, 'node_modules', 'vitest');
  const notFound = err({ kind: 'vitest-not-found', searched: packageDirectory } as const);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  } catch {
    return notFound;
  }
  if (typeof manifest !== 'object' || manifest === null) {
    return notFound;
  }
  const { bin, version } = manifest as { bin?: unknown; version?: unknown };
  const relative =
    typeof bin === 'string'
      ? bin
      : typeof bin === 'object' && bin !== null && 'vitest' in bin
        ? bin.vitest
        : undefined;
  if (typeof relative !== 'string') {
    return notFound;
  }
  try {
    const script = await realpath(path.resolve(packageDirectory, relative));
    const stats = await stat(script);
    if (!stats.isFile()) {
      return notFound;
    }
    return ok({ script, version: typeof version === 'string' ? version : 'unknown' });
  } catch {
    return notFound;
  }
}
