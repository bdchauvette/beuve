import { copyFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

import { test as baseTest } from '#testing/test.ts';

import { listWasmAssets } from '../list-wasm-assets.ts';

/**
 * `#testing/test.ts` with syntax fixtures (ADR 0058): `wasmDirectory` (worker, read-only) is a
 * directory holding the tree-sitter runtime and every grammar except JavaScript's, so tests can
 * load grammars from a custom directory and see the missing one fail.
 */
export const test = baseTest.extend(
  'wasmDirectory',
  { scope: 'worker' },
  ({ tempRoot }): string => {
    const directory = mkdtempSync(path.join(tempRoot, 'wasm-'));
    for (const asset of listWasmAssets()) {
      if (asset.language !== 'javascript') {
        copyFileSync(asset.sourcePath, path.join(directory, asset.fileName));
      }
    }
    return directory;
  },
);
