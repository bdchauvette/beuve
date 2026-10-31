import { chmod, lstat, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { attemptWrite } from '#testing/attempt-write.ts';
import { test } from '#testing/test.ts';

import { chmodTree } from './chmod-tree.ts';

describe('chmodTree', () => {
  test('clears write bits on files and directories, and never follows a link', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const { tree, outside } = await sampleTree(tempDir, signal);
    await chmodTree(tree, { file: withoutWrite, directory: withoutWrite });
    await expect(modesUnder(tree)).resolves.toStrictEqual({
      '.': 0o555,
      'a.txt': 0o444,
      'link-out': 'link',
      sub: 0o555,
      'sub/run.sh': 0o555,
    });
    await expect(modeOf(outside)).resolves.toBe(0o644);
    await expect(attemptWrite(path.join(tree, 'a.txt'), signal)).resolves.toBe('EACCES');
    await expect(attemptWrite(path.join(tree, 'sub', 'new.txt'), signal)).resolves.toBe('EACCES');
    await expect(attemptWrite(outside, signal)).resolves.toBe('written');
  });

  test('opens a closed tree again, directory by directory', async ({ expect, tempDir, signal }) => {
    const { tree } = await sampleTree(tempDir, signal);
    await chmodTree(tree, { file: withoutWrite, directory: withoutWrite });
    await chmodTree(tree, {
      file: (mode) => {
        return mode;
      },
      directory: (mode) => {
        return mode | 0o700;
      },
    });
    await expect(modesUnder(tree)).resolves.toStrictEqual({
      '.': 0o755,
      'a.txt': 0o444,
      'link-out': 'link',
      sub: 0o755,
      'sub/run.sh': 0o555,
    });
    await expect(attemptWrite(path.join(tree, 'sub', 'new.txt'), signal)).resolves.toBe('written');
  });

  test('skips a missing root', async ({ expect, tempDir }) => {
    await expect(
      chmodTree(path.join(tempDir, 'gone'), { file: withoutWrite, directory: withoutWrite }),
    ).resolves.toBeUndefined();
  });
});

function withoutWrite(mode: number): number {
  return mode & ~0o222;
}

/** A small tree, and a file outside it that a link in the tree points to. */
interface SampleTree {
  readonly tree: string;
  readonly outside: string;
}

async function sampleTree(tempDir: string, signal: AbortSignal): Promise<SampleTree> {
  const tree = path.join(tempDir, 'tree');
  const outside = path.join(tempDir, 'outside.txt');
  await mkdir(path.join(tree, 'sub'), { recursive: true });
  await writeFile(path.join(tree, 'a.txt'), 'a\n', { signal });
  await writeFile(path.join(tree, 'sub', 'run.sh'), '#!/bin/sh\n', { signal });
  await writeFile(outside, 'outside\n', { signal });
  await symlink(outside, path.join(tree, 'link-out'));
  // Explicit modes: the umask differs between machines.
  await chmod(tree, 0o755);
  await chmod(path.join(tree, 'sub'), 0o755);
  await chmod(path.join(tree, 'a.txt'), 0o644);
  await chmod(path.join(tree, 'sub', 'run.sh'), 0o755);
  await chmod(outside, 0o644);
  return { tree, outside };
}

/** Every entry's permission bits by relative path (`.` for the root); links read `link`. */
async function modesUnder(root: string): Promise<Record<string, number | 'link'>> {
  const modes: Record<string, number | 'link'> = { '.': await modeOf(root) };
  const listed = await readdir(root, { recursive: true });
  const names = listed.toSorted((left, right) => left.localeCompare(right));
  for (const name of names) {
    modes[name.split(path.sep).join('/')] = await modeOrLink(path.join(root, name));
  }
  return modes;
}

async function modeOrLink(entry: string): Promise<number | 'link'> {
  const stats = await lstat(entry);
  if (stats.isSymbolicLink()) {
    return 'link';
  }
  return stats.mode & 0o7777;
}

async function modeOf(entry: string): Promise<number> {
  const stats = await lstat(entry);
  return stats.mode & 0o7777;
}
