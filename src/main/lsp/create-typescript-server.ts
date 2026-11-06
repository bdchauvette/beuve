import { createRequire } from 'node:module';

import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { typescriptServerDefinition } from '#internal/lsp/typescript-server-definition.ts';

import type { NodeRuntime } from '../node-runtime/resolve-node-runtime.ts';
import { unpackedPathFrom } from './unpacked-path-from.ts';

/**
 * `typescript-language-server` and `tsserver` from beuve's own `node_modules`, never the
 * workspace's (ADR 0017), run by `runtime`: the Node a packaged app ships, or the `node` on
 * `PATH` unpackaged (ADR 0083). A packaged app runs both from `app.asar.unpacked`, where a plain
 * Node can read them (ADR 0048).
 */
export function createTypescriptServer(runtime: NodeRuntime): ServerDefinition {
  const require = createRequire(import.meta.url);
  return typescriptServerDefinition({
    command: runtime.command,
    leadingArgs: [unpackedPathFrom(require.resolve('typescript-language-server/lib/cli.mjs'))],
    tsserverPath: unpackedPathFrom(require.resolve('typescript/lib/tsserver.js')),
    source: 'builtin',
  });
}
