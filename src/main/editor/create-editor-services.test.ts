import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { attemptWrite } from '#testing/attempt-write.ts';

import { test } from './testing/test.ts';

/** `editor:open` through `createMainServices` with a fake platform: nothing is ever launched. */
describe('createEditorServices (integration: git + fake platform, no Electron)', () => {
  test("opens the user's working tree when it is at the session head", async ({
    expect,
    openInEditor,
    editorState,
    repo,
  }) => {
    await repo.git('switch', '--quiet', 'feature');
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      kind: 'opened',
      editorId: 'zed',
      location: 'working-tree',
    });
    expect(editorState.spawned).toStrictEqual([
      { command: '/bin/zed', args: [`${repo.directory}/src/feature.ts:2:1`] },
    ]);
  });

  test("opens beuve's head checkout when the working tree is on another commit", async ({
    expect,
    openInEditor,
    editorState,
    repo,
  }) => {
    const response = await openInEditor('src/feature.ts', 3);
    expect(response).toMatchObject({ kind: 'opened', location: 'beuve-checkout' });
    const [launch] = editorState.spawned;
    expect(launch?.args[0]).toMatch(/worktrees.*src\/feature\.ts:3:1$/u);
    expect(launch?.args[0]?.startsWith(repo.directory)).toBe(false);
  });

  test("beuve's head checkout opens read-only, so an edit there can't change what it serves", async ({
    expect,
    openInEditor,
    editorState,
    signal,
  }) => {
    await openInEditor('src/feature.ts', 3);
    const file = (editorState.spawned[0]?.args[0] ?? '').replace(/:3:1$/u, '');
    const sibling = path.join(path.dirname(file), 'new.ts');
    await expect(attemptWrite(file, signal)).resolves.toBe('EACCES');
    await expect(attemptWrite(sibling, signal)).resolves.toBe('EACCES');
  });

  test('uses the checkout when the working tree file has uncommitted changes', async ({
    expect,
    openInEditor,
    repo,
  }) => {
    await repo.git('switch', '--quiet', 'feature');
    repo.write('src/feature.ts', 'changed\n');
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      location: 'beuve-checkout',
    });
  });

  test('reports a file that is not at the head', async ({ expect, openInEditor, editorState }) => {
    await expect(openInEditor('src/missing.ts')).resolves.toMatchObject({
      kind: 'failed',
      failure: 'file-unavailable',
    });
    expect(editorState.spawned).toStrictEqual([]);
  });

  test('refuses a symlink that leaves the checkout', async ({
    expect,
    openInEditor,
    editorState,
    repo,
    tempDir,
  }) => {
    await repo.git('switch', '--quiet', 'feature');
    const outside = path.join(tempDir, 'secret.txt');
    writeFileSync(outside, 'x');
    mkdirSync(path.join(repo.directory, 'links'));
    symlinkSync(outside, path.join(repo.directory, 'links/out.txt'));
    await repo.commit('add link');
    await expect(openInEditor('links/out.txt')).resolves.toMatchObject({
      failure: 'file-unavailable',
    });
    expect(editorState.spawned).toStrictEqual([]);
  });

  test('reports no editor, and a launch failure', async ({ expect, openInEditor, editorState }) => {
    editorState.installed = [];
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      failure: 'no-editor-found',
    });
    editorState.installed = ['/bin/zed'];
    editorState.spawnError = 'spawn ENOENT';
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      failure: 'launch-failed',
      message: expect.stringContaining('ENOENT') as string,
    });
  });

  test('falls back to an installed editor, and honours the preference', async ({
    expect,
    openInEditor,
    editorState,
    services,
  }) => {
    editorState.installed = ['/bin/code', '/bin/cursor'];
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({ editorId: 'vscode' });
    await services.editor.setPreferred({ editorId: 'cursor' });
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({ editorId: 'cursor' });
    expect(editorState.spawned.at(-1)?.args[0]).toBe('--goto');
    const settings = await services.editor.getSettings();
    expect(settings).toMatchObject({
      ok: true,
      value: {
        preferred: 'cursor',
        editors: [
          { id: 'zed', installed: false },
          { id: 'vscode', installed: true },
          { id: 'cursor', installed: true },
        ],
      },
    });
  });

  test('opens the Zed URL when only the macOS app exists', async ({
    expect,
    openInEditor,
    editorState,
  }) => {
    editorState.installed = ['/Applications/Zed.app'];
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      kind: 'opened',
      editorId: 'zed',
    });
    expect(editorState.spawned).toStrictEqual([]);
    expect(editorState.opened).toHaveLength(1);
    expect(editorState.opened[0]).toMatch(/^zed:\/\/file\/.*worktrees.*\/src\/feature\.ts:2:1$/u);
  });
});
