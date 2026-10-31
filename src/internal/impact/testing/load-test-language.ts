import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { Language, Parser } from 'web-tree-sitter';

import type { TestLanguage } from './parse-test-source.ts';

const require = createRequire(import.meta.url);
// Parser.init is not reentrant: concurrent calls can load a grammar into a half-set-up module.
const initialized = Parser.init({
  locateFile: () => {
    return require.resolve('web-tree-sitter/web-tree-sitter.wasm');
  },
});

/** A grammar's node types and field names. */
export interface GrammarNames {
  readonly types: ReadonlySet<string>;
  readonly fields: ReadonlySet<string>;
}

/** A grammar's node types and field names, to check rule tables for typos. Test-only. */
export async function loadTestLanguage(language: TestLanguage): Promise<GrammarNames> {
  await initialized;
  const path = require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${language}.wasm`);
  const loaded = await Language.load(await readFile(path));
  return {
    types: new Set(loaded.types),
    fields: new Set(loaded.fields.filter((field) => field !== null)),
  };
}
