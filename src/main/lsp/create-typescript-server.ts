import { createRequire } from 'node:module';
import process from 'node:process';

import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { typescriptServerDefinition } from '#internal/lsp/typescript-server-definition.ts';

/**
 * `typescript-language-server` and `tsserver` from beuve's own `node_modules`, never the
 * workspace's (ADR 0017), run by the Node inside the current executable: plain Node under tests,
 * Electron's (`ELECTRON_RUN_AS_NODE=1`) in the app, so no `node` on `PATH` is needed.
 */
export function createTypescriptServer(): ServerDefinition {
  const require = createRequire(import.meta.url);
  return typescriptServerDefinition({
    command: process.execPath,
    leadingArgs: [require.resolve('typescript-language-server/lib/cli.mjs')],
    tsserverPath: require.resolve('typescript/lib/tsserver.js'),
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
}
