import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '#x/log/create-logger.ts';
import { errorFrom } from '#x/error/error-from.ts';

/** What {@link secureUserData} changed: the paths it tightened, relative to `userData`. */
export interface SecuredUserData {
  readonly tightened: readonly string[];
}

/**
 * Makes beuve's `userData` owner-only (ADR 0082). Electron creates the directory 0700, and every
 * file beuve writes there is created 0600, but an older install made `beuve.db`, `settings.json`
 * and `worktrees/` with the default mode (0644 and 0755 under umask 022). On macOS and Linux this
 * creates the directories beuve owns at 0700, then clears the group and other bits of the
 * directory and of each known path. Each path is opened without following a symlink and changed
 * through that handle, so a path swapped meanwhile can't redirect the change; a missing path is
 * skipped. Failures are logged, never thrown: the app still runs, only less private.
 */
export async function secureUserData(userData: string, logger: Logger): Promise<SecuredUserData> {
  if (process.platform === 'win32') {
    return { tightened: [] };
  }
  for (const name of ownedDirectories) {
    await mkdir(path.join(userData, name), { recursive: true, mode: 0o700 });
  }
  const tightened: string[] = [];
  for (const name of ['.', ...ownedDirectories, ...ownedFiles]) {
    const outcome = await tighten(path.join(userData, name));
    if (outcome === 'tightened') {
      tightened.push(name);
    } else if (outcome !== 'unchanged' && outcome !== 'missing') {
      logger.warn('could not make a userData path owner-only', { path: name, error: outcome });
    }
  }
  if (tightened.length > 0) {
    logger.info('made userData paths owner-only', { paths: tightened });
  }
  return { tightened };
}

/**
 * Directories beuve creates in `userData`: session checkouts, plus `deps` (install caches and
 * logs from before the terminal, ADR 0095) and `trace` (probe scratch space, removed by ADR 0096),
 * which older installs may still have on disk.
 */
const ownedDirectories = ['worktrees', 'trace', 'deps'];

/**
 * Files beuve keeps in `userData`, which hold reviews, chat, settings and keys, plus `mcp-token`
 * and `mcp-server.json` (the MCP server's, removed by ADR 0106), which older installs may still
 * have on disk.
 */
const ownedFiles = [
  'beuve.db',
  'beuve.db-wal',
  'beuve.db-shm',
  'settings.json',
  'model-secrets.json',
  'mcp-token',
  'mcp-server.json',
];

async function tighten(file: string): Promise<'tightened' | 'unchanged' | 'missing' | Error> {
  try {
    await using handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const { mode } = await handle.stat();
    const permissions = mode & 0o7777;
    const owned = permissions & ~0o077;
    if (owned === permissions) {
      return 'unchanged';
    }
    await handle.chmod(owned);
    return 'tightened';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    return errorFrom(error);
  }
}
