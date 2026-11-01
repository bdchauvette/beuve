import { createRequire } from 'node:module';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { describeNodeRuntimeError } from '../node-runtime/describe-node-runtime-error.ts';
import type { NodeRuntime, NodeRuntimeError } from '../node-runtime/resolve-node-runtime.ts';
import { unpackedPathFrom } from '../lsp/unpacked-path-from.ts';

import type { CorepackRuntime } from './create-toolchain-finder.ts';

/**
 * beuve's bundled corepack (ADR 0091), run by `node`: the Node a packaged app ships, or the
 * `node` on `PATH` unpackaged (ADR 0083). A packaged app runs it from `app.asar.unpacked`, where
 * a plain Node can read it. Without a Node, why not.
 */
export function resolveCorepack(
  node: Result<NodeRuntime, NodeRuntimeError>,
): Result<CorepackRuntime, string> {
  if (!node.ok) {
    return err(describeNodeRuntimeError(node.error));
  }
  const require = createRequire(import.meta.url);
  return ok({
    node: node.value.command,
    script: unpackedPathFrom(require.resolve('corepack/dist/corepack.js')),
  });
}
