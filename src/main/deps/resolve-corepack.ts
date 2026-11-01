import { createRequire } from 'node:module';
import path from 'node:path';

import { errorFrom } from '#x/error/error-from.ts';
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
 * a plain Node can read it. corepack exports only its `package.json`, so the script is found
 * beside that. Without a Node or corepack, why not; never throws.
 */
export function resolveCorepack(
  node: Result<NodeRuntime, NodeRuntimeError>,
): Result<CorepackRuntime, string> {
  if (!node.ok) {
    return err(describeNodeRuntimeError(node.error));
  }
  try {
    const require = createRequire(import.meta.url);
    const directory = path.dirname(require.resolve('corepack/package.json'));
    const script = path.join(directory, 'dist', 'corepack.js');
    return ok({ node: node.value.command, script: unpackedPathFrom(script) });
  } catch (error: unknown) {
    return err(`beuve's corepack is missing: ${errorFrom(error).message}`);
  }
}
