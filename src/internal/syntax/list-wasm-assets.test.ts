import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { grammars } from './grammars.ts';
import { listWasmAssets } from './list-wasm-assets.ts';

describe('listWasmAssets', () => {
  test('lists the runtime and one existing file per grammar', ({ expect }) => {
    const assets = listWasmAssets();
    expect(assets.map((asset) => asset.language)).toStrictEqual([
      undefined,
      ...Object.keys(grammars),
    ]);
    for (const asset of assets) {
      expect(path.basename(asset.sourcePath)).toBe(asset.fileName);
      expect(existsSync(asset.sourcePath)).toBe(true);
    }
  });
});
