import { rm } from 'node:fs/promises';

import { chmodTree } from './chmod-tree.ts';

/**
 * `rm -rf` for a tree that may have been made read-only: every directory under `path` first gets
 * back its owner's read, write and search bits (deleting an entry needs write permission on its
 * directory, never on the entry itself), then the tree is removed. Links are not followed. A
 * missing `path` is not an error.
 */
export async function removeTree(path: string): Promise<void> {
  await chmodTree(path, {
    file: (mode) => {
      return mode;
    },
    directory: (mode) => {
      return mode | 0o700;
    },
  });
  await rm(path, { recursive: true, force: true });
}
