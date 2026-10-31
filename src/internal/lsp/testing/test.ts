import { mkdtempSync } from 'node:fs';
import path from 'node:path';

import { test as baseTest } from '#testing/test.ts';

import { createTypescriptProject } from './create-typescript-project.ts';
import type { TypescriptProject } from './create-typescript-project.ts';
import { createTypescriptWorkspace } from './create-typescript-workspace.ts';
import type { TypescriptWorkspace } from './create-typescript-workspace.ts';
import { writeFakeLanguageServer } from './write-fake-language-server.ts';

/**
 * `#testing/test.ts` with language-server fixtures (ADR 0058):
 *
 * - `typescriptProject`: a throwaway TypeScript project inside the test's `tempDir`.
 * - `fakeServerScript` (worker): the path of the scripted language server, written once.
 * - `typescriptWorkspace`: a project and a multiplexer over the real typescript-language-server,
 *   private to the test and disposed after it. The server starts on first use.
 * - `sharedTypescriptWorkspace` (worker): one workspace for read-only tests, so they share a
 *   server. A test that edits files or stops the server uses `typescriptWorkspace`.
 */
export const test = baseTest
  .extend('typescriptProject', ({ tempDir }): TypescriptProject => createTypescriptProject(tempDir))
  .extend('fakeServerScript', { scope: 'worker' }, ({ tempRoot }): string => {
    return writeFakeLanguageServer(mkdtempSync(path.join(tempRoot, 'fake-lsp-')));
  })
  .extend('typescriptWorkspace', ({ tempDir }, { onCleanup }): TypescriptWorkspace => {
    const workspace = createTypescriptWorkspace(tempDir);
    onCleanup(async () => {
      await workspace.lsp.dispose();
    });
    return workspace;
  })
  .extend(
    'sharedTypescriptWorkspace',
    { scope: 'worker' },
    ({ tempRoot }, { onCleanup }): TypescriptWorkspace => {
      const workspace = createTypescriptWorkspace(tempRoot);
      onCleanup(async () => {
        await workspace.lsp.dispose();
      });
      return workspace;
    },
  );
