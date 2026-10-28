import { createRequire } from 'node:module';

import { grammars } from './grammars.ts';
import type { SyntaxLanguage } from './grammars.ts';

/** A WebAssembly file the syntax domain loads: the runtime (`language` undefined) or a grammar. */
export interface WasmAsset {
  readonly fileName: string;
  /** Absolute path of the file in `node_modules`. */
  readonly sourcePath: string;
  readonly language: SyntaxLanguage | undefined;
}

/**
 * Every `.wasm` file parsing needs, resolved in `node_modules`. esbuild does not bundle them: the
 * build copies each `sourcePath` to `<wasmDirectory>/<fileName>`, and main passes that directory
 * to `createSyntaxParser` (ADR 0014). Throws if a package is missing, which is a broken install.
 */
export function listWasmAssets(): readonly WasmAsset[] {
  const require = createRequire(import.meta.url);
  const grammarAssets = (Object.keys(grammars) as SyntaxLanguage[]).map((language): WasmAsset => {
    const { wasmFile } = grammars[language];
    return {
      fileName: wasmFile,
      sourcePath: require.resolve(`@vscode/tree-sitter-wasm/wasm/${wasmFile}`),
      language,
    };
  });
  return [
    {
      fileName: 'web-tree-sitter.wasm',
      sourcePath: require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
      language: undefined,
    },
    ...grammarAssets,
  ];
}
