import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Language, Parser } from 'web-tree-sitter';

import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { detectLanguage } from './detect-language.ts';
import { grammars } from './grammars.ts';
import type { SyntaxLanguage } from './grammars.ts';
import { listWasmAssets } from './list-wasm-assets.ts';
import type { SyntaxNode } from './syntax-node.ts';

export interface SyntaxParserOptions {
  /**
   * Directory holding the runtime and grammar `.wasm` files under their {@link listWasmAssets}
   * names. Defaults to their locations in `node_modules`, which suits tests and `npm start`; a
   * packaged app must pass it.
   */
  readonly wasmDirectory?: string | undefined;
  /** Sources longer than this (UTF-16 code units) are refused as `too-large`. */
  readonly maxSourceLength?: number | undefined;
}

/** Why a source could not be parsed. Syntax errors are not failures: see `SyntaxNode.hasError`. */
export type SyntaxFailure =
  | { readonly kind: 'unsupported-language'; readonly path: string }
  | { readonly kind: 'too-large'; readonly length: number; readonly limit: number }
  | { readonly kind: 'load-failed'; readonly language: SyntaxLanguage; readonly message: string };

/**
 * Parses `text` as the language of `path` and hands the root to `use`, whose (plain-data) result
 * it returns. The tree is freed when `use` returns, so nodes must not escape it.
 */
export type ParseSyntax = <T>(
  source: SyntaxSource,
  use: (root: SyntaxNode, language: SyntaxLanguage) => T,
) => Promise<Result<T, SyntaxFailure>>;

/** A file's text and the path whose extension names its language. */
export interface SyntaxSource {
  readonly path: string;
  readonly text: string;
}

export interface SyntaxParser {
  readonly parse: ParseSyntax;
}

/** About 1 MB: parsing and walking cost roughly a second per megabyte; larger files are usually generated. */
const defaultMaxSourceLength = 1_000_000;
const runtimeWasmFile = 'web-tree-sitter.wasm';

/**
 * The web-tree-sitter runtime is one WebAssembly instance per process: initializing it again would
 * orphan every loaded language, so the first initialization wins.
 */
const runtime: { ready: Promise<void> | undefined } = { ready: undefined };

/**
 * A Tree-sitter parser (ADR 0014). The runtime and each grammar load lazily on first use and are
 * cached; parsing is synchronous once they have loaded. Trees never outlive a `parse` call.
 */
export function createSyntaxParser(options: SyntaxParserOptions = {}): SyntaxParser {
  const maxSourceLength = options.maxSourceLength ?? defaultMaxSourceLength;
  const locate = (fileName: string): string => {
    if (options.wasmDirectory === undefined) {
      return defaultWasmPath(fileName);
    }
    return path.join(options.wasmDirectory, fileName);
  };
  const languages = new Map<SyntaxLanguage, Promise<Result<Language, SyntaxFailure>>>();
  let parser: Parser | undefined;

  const loadLanguage = async (
    language: SyntaxLanguage,
  ): Promise<Result<Language, SyntaxFailure>> => {
    const cached = languages.get(language);
    if (cached !== undefined) {
      return cached;
    }
    const loading = loadGrammar(language, locate);
    languages.set(language, loading);
    const loaded = await loading;
    if (!loaded.ok) {
      languages.delete(language);
    }
    return loaded;
  };

  const parse: ParseSyntax = async ({ path: filePath, text }, use) => {
    const language = detectLanguage(filePath);
    if (language === undefined) {
      return err({ kind: 'unsupported-language', path: filePath });
    }
    if (text.length > maxSourceLength) {
      return err({ kind: 'too-large', length: text.length, limit: maxSourceLength });
    }
    const loaded = await loadLanguage(language);
    if (!loaded.ok) {
      return loaded;
    }
    parser ??= new Parser();
    parser.setLanguage(loaded.value);
    const tree = parser.parse(text);
    if (tree === null) {
      return err({ kind: 'load-failed', language, message: 'the parser returned no tree' });
    }
    using stack = new DisposableStack();
    stack.defer(() => {
      tree.delete();
    });
    return ok(use(tree.rootNode, language));
  };

  return { parse };
}

async function loadGrammar(
  language: SyntaxLanguage,
  locate: (fileName: string) => string,
): Promise<Result<Language, SyntaxFailure>> {
  try {
    runtime.ready ??= initializeRuntime(locate(runtimeWasmFile));
    await runtime.ready;
    const bytes = await readFile(locate(grammars[language].wasmFile));
    return ok(await Language.load(bytes));
  } catch (error) {
    return err({
      kind: 'load-failed',
      language,
      message: errorFrom(error).message,
    });
  }
}

async function initializeRuntime(runtimePath: string): Promise<void> {
  try {
    await Parser.init({ locateFile: () => runtimePath });
  } catch (error) {
    runtime.ready = undefined;
    throw error;
  }
}

function defaultWasmPath(fileName: string): string {
  const asset = listWasmAssets().find((candidate) => candidate.fileName === fileName);
  if (asset === undefined) {
    throw new Error(`no wasm asset named ${fileName}`);
  }
  return asset.sourcePath;
}
