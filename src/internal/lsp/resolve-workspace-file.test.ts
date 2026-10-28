import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveWorkspaceFile } from './resolve-workspace-file.ts';
import { resolveWorkspaceRoot } from './resolve-workspace-root.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

describe('resolveWorkspaceRoot and resolveWorkspaceFile', () => {
  let parent: string;
  let root: WorkspaceRoot;

  beforeEach(async () => {
    const created = mkdtempSync(path.join(os.tmpdir(), 'beuve-root-'));
    parent = realpathSync(created);
    mkdirSync(path.join(parent, 'repo', 'src'), { recursive: true });
    writeFileSync(path.join(parent, 'repo', 'src', 'a b.ts'), 'x');
    writeFileSync(path.join(parent, 'outside.ts'), 'x');
    symlinkSync(path.join(parent, 'repo'), path.join(parent, 'link'));
    const resolved = await resolveWorkspaceRoot(path.join(parent, 'link'));
    if (!resolved.ok) {
      throw new Error('root did not resolve');
    }
    root = resolved.value;
  });
  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it('resolves roots to their real path and rejects bad ones', async () => {
    expect(root).toBe(path.join(parent, 'repo'));
    for (const bad of [
      '',
      'relative',
      path.join(parent, 'missing'),
      path.join(parent, 'outside.ts'),
      `${parent}\0`,
    ]) {
      await expect(resolveWorkspaceRoot(bad), bad).resolves.toMatchObject({
        ok: false,
        error: { kind: 'invalid-root' },
      });
    }
  });

  it('resolves relative and absolute files inside the root', async () => {
    const expected = {
      root,
      absolutePath: path.join(root, 'src', 'a b.ts'),
      relativePath: 'src/a b.ts',
      uri: pathToFileURL(path.join(root, 'src', 'a b.ts')).href,
      bytes: 1,
    };
    await expect(resolveWorkspaceFile(root, 'src/a b.ts')).resolves.toEqual({
      ok: true,
      value: expected,
    });
    await expect(
      resolveWorkspaceFile(root, path.join(parent, 'link', 'src', 'a b.ts')),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'path-outside-root' },
    });
    await expect(resolveWorkspaceFile(root, path.join(root, 'src', 'a b.ts'))).resolves.toEqual({
      ok: true,
      value: expected,
    });
  });

  it('refuses escapes, symlinks out of the root, directories and missing files', async () => {
    symlinkSync(path.join(parent, 'outside.ts'), path.join(root, 'src', 'escape.ts'));
    const cases = [
      ['../outside.ts', 'path-outside-root'],
      ['src/../../outside.ts', 'path-outside-root'],
      ['src/escape.ts', 'path-outside-root'],
      ['src', 'invalid-path'],
      ['src/missing.ts', 'invalid-path'],
      ['src/a\0.ts', 'invalid-path'],
    ] as const;
    for (const [file, kind] of cases) {
      await expect(resolveWorkspaceFile(root, file), file).resolves.toMatchObject({
        ok: false,
        error: { kind },
      });
    }
  });
});
