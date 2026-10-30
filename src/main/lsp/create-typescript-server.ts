import { createRequire } from 'node:module';
import process from 'node:process';

import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { typescriptServerDefinition } from '#internal/lsp/typescript-server-definition.ts';

import { unpackedPathFrom } from './unpacked-path-from.ts';

/**
 * `typescript-language-server` and `tsserver` from beuve's own `node_modules`, never the
 * workspace's (ADR 0017), run by the Node inside the current executable: plain Node under tests,
 * Electron's (`ELECTRON_RUN_AS_NODE=1`) in the app, so no `node` on `PATH` is needed. A packaged
 * app runs both from `app.asar.unpacked`: tsserver resolves its `lib.*.d.ts` only partly through
 * Electron's asar layer and then reports wrong diagnostics (ADR 0048).
 */
export function createTypescriptServer(): ServerDefinition {
  const require = createRequire(import.meta.url);
  return typescriptServerDefinition({
    command: process.execPath,
    leadingArgs: [unpackedPathFrom(require.resolve('typescript-language-server/lib/cli.mjs'))],
    tsserverPath: unpackedPathFrom(require.resolve('typescript/lib/tsserver.js')),
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
}
