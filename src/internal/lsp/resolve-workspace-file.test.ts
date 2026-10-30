import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { test } from '#testing/test.ts';

import { resolveWorkspaceFile } from './resolve-workspace-file.ts';
import { resolveWorkspaceRoot } from './resolve-workspace-root.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

describe('resolveWorkspaceRoot and resolveWorkspaceFile', () => {
  test('resolves roots to their real path', async ({ expect, tempDir }) => {
    const { parent, root } = await workspace(tempDir);
    expect(root).toBe(path.join(parent, 'repo'));
  });

  test.for([
    ['an empty path', (): string => ''],
    ['a relative path', (): string => 'relative'],
    ['a missing directory', (parent: string): string => path.join(parent, 'missing')],
    ['a file', (parent: string): string => path.join(parent, 'outside.ts')],
    ['a path with a NUL byte', (parent: string): string => `${parent}\0`],
  ] as const)('rejects %s as a root', async ([, bad], { expect, tempDir }) => {
    const { parent } = await workspace(tempDir);
    await expect(resolveWorkspaceRoot(bad(parent))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-root' },
    });
  });

  test('resolves relative and absolute files inside the root', async ({ expect, tempDir }) => {
    const { parent, root } = await workspace(tempDir);
    const expected = {
      root,
      absolutePath: path.join(root, 'src', 'a b.ts'),
      relativePath: 'src/a b.ts',
      uri: pathToFileURL(path.join(root, 'src', 'a b.ts')).href,
      bytes: 1,
    };
    await expect(resolveWorkspaceFile(root, 'src/a b.ts')).resolves.toStrictEqual({
      ok: true,
      value: expected,
    });
    await expect(
      resolveWorkspaceFile(root, path.join(parent, 'link', 'src', 'a b.ts')),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'path-outside-root' },
    });
    await expect(
      resolveWorkspaceFile(root, path.join(root, 'src', 'a b.ts')),
    ).resolves.toStrictEqual({
      ok: true,
      value: expected,
    });
  });

  test.for([
    ['a parent escape', '../outside.ts', 'path-outside-root'],
    ['a nested parent escape', 'src/../../outside.ts', 'path-outside-root'],
    ['a symlink out of the root', 'src/escape.ts', 'path-outside-root'],
    ['a directory', 'src', 'invalid-path'],
    ['a missing file', 'src/missing.ts', 'invalid-path'],
    ['a NUL byte', 'src/a\0.ts', 'invalid-path'],
  ] as const)('refuses %s', async ([, file, kind], { expect, tempDir }) => {
    const { parent, root } = await workspace(tempDir);
    symlinkSync(path.join(parent, 'outside.ts'), path.join(root, 'src', 'escape.ts'));
    await expect(resolveWorkspaceFile(root, file)).resolves.toMatchObject({
      ok: false,
      error: { kind },
    });
  });
});

/** A repository reached through a symlink, a file next to it, and the resolved root. */
async function workspace(
  tempDir: string,
): Promise<{ readonly parent: string; readonly root: WorkspaceRoot }> {
  mkdirSync(path.join(tempDir, 'repo', 'src'), { recursive: true });
  writeFileSync(path.join(tempDir, 'repo', 'src', 'a b.ts'), 'x');
  writeFileSync(path.join(tempDir, 'outside.ts'), 'x');
  symlinkSync(path.join(tempDir, 'repo'), path.join(tempDir, 'link'));
  const root = okValueFrom(await resolveWorkspaceRoot(path.join(tempDir, 'link')));
  return { parent: tempDir, root };
}
