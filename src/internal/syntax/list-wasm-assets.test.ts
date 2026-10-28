import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { grammars } from './grammars.ts';
import { listWasmAssets } from './list-wasm-assets.ts';

describe('listWasmAssets', () => {
  it('lists the runtime and one existing file per grammar', () => {
    const assets = listWasmAssets();
    expect(assets.map((asset) => asset.language)).toEqual([undefined, ...Object.keys(grammars)]);
    for (const asset of assets) {
      expect(path.basename(asset.sourcePath)).toBe(asset.fileName);
      expect(existsSync(asset.sourcePath)).toBe(true);
    }
  });
});
