import { open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

const prebuilds = path.resolve(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

await fixNodePtyPermissions();

/**
 * Makes node-pty's macOS `spawn-helper` executable (ADR 0095). node-pty 1.1.0 publishes its
 * prebuilt helper as `-rw-r--r--` and its own `postinstall` does not fix that, so `pty.fork` fails
 * with `posix_spawnp failed` on macOS. Runs as this package's `postinstall`; a missing prebuilds
 * directory (an install without node-pty, or one that compiled it) is not an error.
 */
async function fixNodePtyPermissions(): Promise<void> {
  let targets: string[];
  try {
    targets = await readdir(prebuilds);
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
  for (const target of targets) {
    if (target.startsWith('darwin-')) {
      await makeExecutable(path.join(prebuilds, target, 'spawn-helper'));
    }
  }
}

async function makeExecutable(file: string): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
  await using opened = handle;
  await opened.chmod(0o755);
}

function isNotFound(error: unknown): boolean {
  return Error.isError(error) && 'code' in error && error.code === 'ENOENT';
}
