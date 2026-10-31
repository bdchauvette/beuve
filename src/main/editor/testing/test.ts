import type { EditorOpenResponse } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { MainServices } from '../../main-services.ts';
import { test as baseTest } from '../../testing/test.ts';
import type { EditorPlatform } from '../editor-platform.ts';
import { editorBranchTemplate } from './editor-branch-template.ts';

/** What the fake editor platform saw and how it behaves; tests change `installed` and `spawnError`. */
export interface EditorState {
  readonly spawned: { command: string; args: readonly string[] }[];
  readonly opened: string[];
  installed: string[];
  spawnError: string | undefined;
}

/** Calls `editor:open` on the test session and returns the response. */
export type OpenInEditor = (file: string, line?: number) => Promise<EditorOpenResponse>;

/**
 * `src/main`'s `test` with an editor platform that launches nothing (ADR 0058): `repo` is
 * {@link editorBranchTemplate}, `editorState` records the fake platform's calls, `services` uses
 * it, `sessionId` is a local session on `feature` and `openInEditor` calls `editor:open`.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(editorBranchTemplate());
    return repo;
  })
  .extend('editorState', (): EditorState => {
    return {
      spawned: [],
      opened: [],
      installed: ['/bin/zed'],
      spawnError: undefined,
    };
  })
  .extend('services', ({ createServices, editorState }): MainServices => {
    const platform: EditorPlatform = {
      platform: 'darwin',
      env: { PATH: '/bin', HOME: '/home/me' },
      exists: (file) => {
        return editorState.installed.includes(file);
      },
      spawn: async (command, args): Promise<Result<void, string>> => {
        editorState.spawned.push({ command, args });
        await Promise.resolve();
        return editorState.spawnError === undefined ? ok(undefined) : err(editorState.spawnError);
      },
      openExternal: async (url): Promise<void> => {
        editorState.opened.push(url);
        await Promise.resolve();
      },
    };
    return createServices({ editor: { platform } });
  })
  .extend('sessionId', async ({ services, repo }): Promise<string> => {
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    return okValueFrom(created).id;
  })
  .extend('openInEditor', ({ services, sessionId }): OpenInEditor => {
    return async (file, line = 2) => {
      return okValueFrom(await services.editor.open({ sessionId, path: file, line }));
    };
  });
