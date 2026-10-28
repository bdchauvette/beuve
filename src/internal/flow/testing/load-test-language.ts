import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { Language, Parser } from 'web-tree-sitter';

import type { TestLanguage } from './parse-test-source.ts';

const require = createRequire(import.meta.url);

/** A grammar's node types and field names, to check rule tables for typos. Test-only. */
export async function loadTestLanguage(
  language: TestLanguage,
): Promise<{ readonly types: ReadonlySet<string>; readonly fields: ReadonlySet<string> }> {
  await Parser.init({
    locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
  });
  const path = require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${language}.wasm`);
  const loaded = await Language.load(await readFile(path));
  return {
    types: new Set(loaded.types),
    fields: new Set(loaded.fields.filter((field) => field !== null)),
  };
}
