import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { Language, Parser } from 'web-tree-sitter';

import type { ImpactNode } from '../impact-node.ts';

/** Grammars the ImpactGate tests parse with, by their wasm names in `@vscode/tree-sitter-wasm`. */
export type TestLanguage = 'typescript' | 'tsx' | 'javascript';

const require = createRequire(import.meta.url);
const languages = new Map<TestLanguage, Promise<Language>>();
const state: { runtime: Promise<void> | undefined; parser: Parser | undefined } = {
  runtime: undefined,
  parser: undefined,
};

/**
 * Parses `source` with the real grammar, so ImpactGate's tests exercise the rule tables against
 * the trees main will hand over. Test-only (ADR 0013): it loads web-tree-sitter itself instead of
 * importing the syntax domain (ADR 0002). Trees are never freed; tests are short-lived.
 */
export async function parseTestSource(
  source: string,
  language: TestLanguage = 'typescript',
): Promise<ImpactNode> {
  state.runtime ??= Parser.init({
    locateFile: () => {
      return require.resolve('web-tree-sitter/web-tree-sitter.wasm');
    },
  });
  await state.runtime;
  let loading = languages.get(language);
  if (loading === undefined) {
    loading = loadLanguage(language);
    languages.set(language, loading);
  }
  const loaded = await loading;
  state.parser ??= new Parser();
  state.parser.setLanguage(loaded);
  const tree = state.parser.parse(source);
  if (tree === null) {
    throw new Error('tree-sitter returned no tree');
  }
  return tree.rootNode;
}

async function loadLanguage(language: TestLanguage): Promise<Language> {
  const path = require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${language}.wasm`);
  return Language.load(await readFile(path));
}
