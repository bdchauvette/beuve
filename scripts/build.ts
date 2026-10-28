import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';

import { listWasmAssets } from '../src/internal/syntax/list-wasm-assets.ts';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

await buildAll();

/**
 * Bundles main (ESM), preload (CJS, sandboxed per ADR 0005) and ui (ESM) into dist/, and copies
 * the Tree-sitter runtime and grammar wasm files main loads from `dist/main/wasm/` (ADR 0014).
 */
async function buildAll(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await Promise.all([build(mainOptions()), build(preloadOptions()), build(uiOptions())]);
  await copyFile(path.join(root, 'src/ui/index.html'), path.join(dist, 'ui/index.html'));
  await copyWasmAssets(path.join(dist, 'main/wasm'));
}

async function copyWasmAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    listWasmAssets().map(async (asset) =>
      copyFile(asset.sourcePath, path.join(directory, asset.fileName)),
    ),
  );
}

function mainOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(dist, 'main/index.js'),
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  };
}

function preloadOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(dist, 'preload/index.cjs'),
    platform: 'node',
    target: 'node24',
    format: 'cjs',
  };
}

function uiOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/ui/index.ts'), path.join(root, 'src/ui/index.css')],
    outdir: path.join(dist, 'ui'),
    platform: 'browser',
    target: 'chrome140',
    format: 'esm',
  };
}

function sharedOptions(): BuildOptions {
  return {
    bundle: true,
    external: ['electron'],
    sourcemap: 'linked',
    logLevel: 'warning',
    absWorkingDir: root,
  };
}
