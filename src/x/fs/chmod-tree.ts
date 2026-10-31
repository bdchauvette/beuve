import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

/** The new permission bits for an entry, from its current ones (`mode & 0o7777`). */
export type ModeChange = (mode: number) => number;

/** How {@link chmodTree} changes regular files and directories. */
export interface TreeModes {
  readonly file: ModeChange;
  readonly directory: ModeChange;
}

/** Entries changed at once inside one directory. */
const concurrency = 32;
const permissionBits = 0o7777;
/** What `open` answers for a symbolic link with `O_NOFOLLOW` (Linux, macOS; BSD), or a gone entry. */
const skippedOpenCodes = new Set(['ELOOP', 'EMLINK', 'ENOENT', 'ENXIO']);

/**
 * Changes the permission bits of `root` and every regular file and directory under it, as
 * `modes` says. Symbolic links are never followed or changed (a link's target may lie outside the
 * tree), and nor is anything that is neither a regular file nor a directory. Each entry is opened
 * without following links and changed through its handle, so a path swapped for a link between
 * the listing and the change is skipped, not followed. A directory gains the bits its change adds
 * before its entries are visited and loses the ones it removes only after, so the same call can
 * close a tree (a-w) or open it again (u+w). An entry that vanishes meanwhile is skipped; any
 * other failure rejects.
 */
export async function chmodTree(root: string, modes: TreeModes): Promise<void> {
  await visit(root, modes);
}

async function visit(entry: string, modes: TreeModes): Promise<void> {
  const target = await openDirectory(entry, modes);
  if (target === undefined) {
    return;
  }
  const names = await listNames(entry);
  for (let start = 0; start < names.length; start += concurrency) {
    await Promise.all(
      names.slice(start, start + concurrency).map(async (name): Promise<void> => {
        await visit(path.join(entry, name), modes);
      }),
    );
  }
  await settleDirectory(entry, target);
}

/**
 * Changes a file outright and answers `undefined`; for a directory, adds the bits its change adds
 * and answers the mode it ends with.
 */
async function openDirectory(entry: string, modes: TreeModes): Promise<number | undefined> {
  await using handle = await openEntry(entry);
  if (handle === undefined) {
    return undefined;
  }
  const stats = await handle.stat();
  const mode = stats.mode & permissionBits;
  if (stats.isFile()) {
    const next = modes.file(mode);
    if (next !== mode) {
      await handle.chmod(next);
    }
    return undefined;
  }
  if (!stats.isDirectory()) {
    return undefined;
  }
  const next = modes.directory(mode);
  const widened = mode | next;
  if (widened !== mode) {
    await handle.chmod(widened);
  }
  return next;
}

/** Gives a visited directory its final mode. */
async function settleDirectory(entry: string, mode: number): Promise<void> {
  await using handle = await openEntry(entry);
  if (handle === undefined) {
    return;
  }
  const stats = await handle.stat();
  if (stats.isDirectory() && (stats.mode & permissionBits) !== mode) {
    await handle.chmod(mode);
  }
}

/** Opens `entry` without following a link; `undefined` when it is a link or gone. */
async function openEntry(entry: string): Promise<FileHandle | undefined> {
  try {
    return await open(entry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error: unknown) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== undefined && skippedOpenCodes.has(code)) {
      return undefined;
    }
    throw error;
  }
}

async function listNames(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
