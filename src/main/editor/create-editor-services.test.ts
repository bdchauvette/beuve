import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EditorOpenResponse, IpcResult } from '#contract/ipc-contract.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#pkg/logger/create-logger.ts';
import type { Result } from '#pkg/result/result.ts';
import { ok } from '#pkg/result/ok.ts';
import { err } from '#pkg/result/err.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';

import type { EditorPlatform } from './editor-platform.ts';

/** `editor:open` through `createMainServices` with a fake platform: nothing is ever launched. */
const settled = Promise.resolve();
const checkoutLaunch = /worktrees.*src\/feature\.ts:3:1$/u;
const zedCheckoutUrl = /^zed:\/\/file\/.*worktrees.*\/src\/feature\.ts:2:1$/u;

describe('createEditorServices (integration: git + fake platform, no Electron)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let services: MainServices;
  let sessionId: string;
  let spawned: { command: string; args: readonly string[] }[];
  let opened: string[];
  let installed: string[];
  let spawnError: string | undefined;

  const platform = (): EditorPlatform => ({
    platform: 'darwin',
    env: { PATH: '/bin', HOME: '/home/me' },
    exists: (file) => installed.includes(file),
    spawn: async (command, args): Promise<Result<void, string>> => {
      spawned.push({ command, args });
      await settled;
      return spawnError === undefined ? ok(undefined) : err(spawnError);
    },
    openExternal: async (url): Promise<void> => {
      opened.push(url);
      await settled;
    },
  });

  beforeEach(async () => {
    spawned = [];
    opened = [];
    installed = ['/bin/zed'];
    spawnError = undefined;
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    repo.write('app.ts', 'one\n');
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('src/feature.ts', 'a\nb\nc\n');
    repo.commit('add feature');
    repo.git('switch', '--quiet', 'main');
    let id = 0;
    const deps: SessionDeps = {
      now: (): Date => new Date(Date.UTC(2026, 9, 28)),
      newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    };
    services = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      deps,
      worktreeRoot: path.join(repo.scratch(), 'worktrees'),
      editor: { platform: platform() },
    });
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    if (!created.ok) {
      throw new Error('session');
    }
    sessionId = created.value.id;
  });

  afterEach(async () => {
    await services.dispose();
    db.close();
    repo.cleanup();
  });

  const open = async (file: string, line = 2): Promise<EditorOpenResponse> => {
    const result: IpcResult<EditorOpenResponse> = await services.editor.open({
      sessionId,
      path: file,
      line,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value;
  };

  it("opens the user's working tree when it is at the session head", async () => {
    repo.git('switch', '--quiet', 'feature');
    expect(await open('src/feature.ts')).toMatchObject({
      kind: 'opened',
      editorId: 'zed',
      location: 'working-tree',
    });
    expect(spawned).toEqual([
      { command: '/bin/zed', args: [`${repo.directory}/src/feature.ts:2:1`] },
    ]);
  });

  it("opens beuve's head checkout when the working tree is on another commit", async () => {
    const response = await open('src/feature.ts', 3);
    expect(response).toMatchObject({ kind: 'opened', location: 'beuve-checkout' });
    const [launch] = spawned;
    expect(launch?.args[0]).toMatch(checkoutLaunch);
    expect(launch?.args[0]?.startsWith(repo.directory)).toBe(false);
  });

  it('uses the checkout when the working tree file has uncommitted changes', async () => {
    repo.git('switch', '--quiet', 'feature');
    repo.write('src/feature.ts', 'changed\n');
    expect(await open('src/feature.ts')).toMatchObject({ location: 'beuve-checkout' });
  });

  it('reports a file that is not at the head', async () => {
    expect(await open('src/missing.ts')).toMatchObject({
      kind: 'failed',
      failure: 'file-unavailable',
    });
    expect(spawned).toEqual([]);
  });

  it('refuses a symlink that leaves the checkout', async () => {
    repo.git('switch', '--quiet', 'feature');
    const outside = path.join(repo.scratch(), 'secret.txt');
    writeFileSync(outside, 'x');
    mkdirSync(path.join(repo.directory, 'links'));
    symlinkSync(outside, path.join(repo.directory, 'links/out.txt'));
    repo.commit('add link');
    expect(await open('links/out.txt')).toMatchObject({ failure: 'file-unavailable' });
    expect(spawned).toEqual([]);
  });

  it('reports no editor, and a launch failure', async () => {
    installed = [];
    expect(await open('src/feature.ts')).toMatchObject({ failure: 'no-editor-found' });
    installed = ['/bin/zed'];
    spawnError = 'spawn ENOENT';
    expect(await open('src/feature.ts')).toMatchObject({
      failure: 'launch-failed',
      message: expect.stringContaining('ENOENT') as string,
    });
  });

  it('falls back to an installed editor, and honours the preference', async () => {
    installed = ['/bin/code', '/bin/cursor'];
    expect(await open('src/feature.ts')).toMatchObject({ editorId: 'vscode' });
    await services.editor.setPreferred({ editorId: 'cursor' });
    expect(await open('src/feature.ts')).toMatchObject({ editorId: 'cursor' });
    expect(spawned.at(-1)?.args[0]).toBe('--goto');
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

  it('opens the Zed URL when only the macOS app exists', async () => {
    installed = ['/Applications/Zed.app'];
    expect(await open('src/feature.ts')).toMatchObject({ kind: 'opened', editorId: 'zed' });
    expect(spawned).toEqual([]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(zedCheckoutUrl);
  });
});
