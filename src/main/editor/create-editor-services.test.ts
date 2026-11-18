import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

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

  test("beuve's head checkout is read-only by convention: the answer names its commit for the notice", async ({
    expect,
    openInEditor,
    repo,
  }) => {
    await expect(openInEditor('src/feature.ts', 3)).resolves.toMatchObject({
      location: 'beuve-checkout',
      headSha: await repo.git('rev-parse', 'feature'),
    });
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

  test('asks for a choice among several editors, then honors it', async ({
    expect,
    openInEditor,
    editorState,
    services,
  }) => {
    editorState.installed = ['/bin/code', '/bin/cursor'];
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      kind: 'failed',
      failure: 'editor-not-chosen',
    });
    expect(editorState.spawned).toStrictEqual([]);
    await services.editor.setPreferred({ editorId: 'cursor' });
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({ editorId: 'cursor' });
    expect(editorState.spawned.at(-1)?.args[0]).toBe('--goto');
    const settings = await services.editor.getSettings();
    expect(settings).toMatchObject({
      ok: true,
      value: {
        preferred: 'cursor',
        current: 'cursor',
        editors: [
          { id: 'zed', installed: false },
          { id: 'gram', installed: false },
          { id: 'vscode', installed: true, found: { kind: 'cli', path: '/bin/code' } },
          { id: 'cursor', installed: true, origin: 'built-in' },
        ],
        problems: [],
      },
    });
  });

  test('never opens another editor when the chosen one is missing', async ({
    expect,
    openInEditor,
    editorState,
    services,
  }) => {
    editorState.installed = ['/bin/zed', '/bin/cursor'];
    await services.editor.setPreferred({ editorId: 'gram' });
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({
      kind: 'failed',
      failure: 'editor-unavailable',
      message: expect.stringContaining('Gram, your chosen editor, was not found') as string,
    });
    expect(editorState.spawned).toStrictEqual([]);
    editorState.installed = ['/Applications/Gram.app/Contents/MacOS/cli'];
    await expect(openInEditor('src/feature.ts')).resolves.toMatchObject({ editorId: 'gram' });
    expect(editorState.spawned.at(-1)?.command).toBe('/Applications/Gram.app/Contents/MacOS/cli');
  });

  test('opens an editor of the reviewer’s own from settings.json', async ({
    expect,
    openInEditor,
    editorState,
    services,
    repo,
  }) => {
    await repo.git('switch', '--quiet', 'feature');
    mkdirSync(path.dirname(editorState.settingsPath), { recursive: true });
    writeFileSync(
      editorState.settingsPath,
      JSON.stringify({
        editors: {
          helix: { name: 'Helix', command: 'kitty', args: ['hx', '{file}:{line}:{column}'] },
          cursor: { enabled: false },
          vim: { name: 'Vim' },
        },
      }),
    );
    editorState.installed = ['/bin/zed', '/bin/kitty'];
    const settings = await services.editor.getSettings();
    expect(settings).toMatchObject({
      ok: true,
      value: {
        editors: [
          { id: 'zed' },
          { id: 'gram' },
          { id: 'vscode' },
          { id: 'helix', name: 'Helix', installed: true, origin: 'custom' },
        ],
        problems: ['editors.vim: a new editor needs a "command"'],
      },
    });
    await expect(services.editor.setPreferred({ editorId: 'cursor' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    await services.editor.setPreferred({ editorId: 'helix' });
    await expect(openInEditor('src/feature.ts', 3)).resolves.toMatchObject({
      kind: 'opened',
      editorId: 'helix',
      editorName: 'Helix',
    });
    expect(editorState.spawned).toStrictEqual([
      { command: '/bin/kitty', args: ['hx', `${repo.directory}/src/feature.ts:3:1`] },
    ]);
    expect(JSON.parse(readFileSync(editorState.settingsPath, 'utf8'))).toMatchObject({
      preferredEditor: 'helix',
      editors: { helix: { command: 'kitty' } },
    });
  });

  test('tells listeners when the editors change, once per change', async ({
    expect,
    editorState,
    services,
  }) => {
    const seen: (string | undefined)[] = [];
    const unsubscribe = services.editor.onChanged((view) => {
      seen.push(view.current);
    });
    await services.editor.getSettings();
    await services.editor.getSettings();
    editorState.installed = [];
    await services.editor.getSettings();
    unsubscribe();
    editorState.installed = ['/bin/zed'];
    await services.editor.getSettings();
    expect(seen).toStrictEqual(['zed', undefined]);
  });

  test('opens settings.json, creating it only when missing', async ({
    expect,
    editorState,
    services,
  }) => {
    await expect(services.editor.openSettingsFile()).resolves.toStrictEqual({
      ok: true,
      value: { path: editorState.settingsPath, created: true },
    });
    expect(readFileSync(editorState.settingsPath, 'utf8')).toBe('{}\n');
    writeFileSync(editorState.settingsPath, '{ "editors": {} }');
    await expect(services.editor.openSettingsFile()).resolves.toMatchObject({
      value: { created: false },
    });
    expect(readFileSync(editorState.settingsPath, 'utf8')).toBe('{ "editors": {} }');
    expect(editorState.openedPaths).toStrictEqual([
      editorState.settingsPath,
      editorState.settingsPath,
    ]);
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
