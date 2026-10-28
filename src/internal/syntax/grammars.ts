/** A Tree-sitter grammar: its WebAssembly file in `@vscode/tree-sitter-wasm` and the extensions it parses. */
export interface Grammar {
  readonly wasmFile: string;
  readonly extensions: readonly string[];
}

/**
 * The grammars beuve can parse, keyed by language id (ADR 0014). Adding a language is a new entry
 * here (plus rules in the consumers that interpret its trees, such as ImpactGate's).
 */
export const grammars = {
  typescript: { wasmFile: 'tree-sitter-typescript.wasm', extensions: ['.ts', '.mts', '.cts'] },
  tsx: { wasmFile: 'tree-sitter-tsx.wasm', extensions: ['.tsx'] },
  javascript: {
    wasmFile: 'tree-sitter-javascript.wasm',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
  },
} as const satisfies Readonly<Record<string, Grammar>>;

/** A language id with a grammar in {@link grammars}. */
export type SyntaxLanguage = keyof typeof grammars;
