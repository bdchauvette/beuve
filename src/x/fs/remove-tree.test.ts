import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { chmodTree } from './chmod-tree.ts';
import { removeTree } from './remove-tree.ts';

describe('removeTree', () => {
  test('removes a tree whose files and directories are read-only', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const tree = path.join(tempDir, 'tree');
    await mkdir(path.join(tree, 'a', 'b'), { recursive: true });
    await writeFile(path.join(tree, 'a', 'b', 'f.txt'), 'f\n', { signal });
    await chmodTree(tree, { file: withoutWrite, directory: withoutWrite });
    await removeTree(tree);
    expect(existsSync(tree)).toBe(false);
  });

  test('accepts a missing path', async ({ expect, tempDir }) => {
    await expect(removeTree(path.join(tempDir, 'gone'))).resolves.toBeUndefined();
  });
});

function withoutWrite(mode: number): number {
  return mode & ~0o222;
}
