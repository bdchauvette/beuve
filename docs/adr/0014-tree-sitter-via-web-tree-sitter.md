# 0014. Tree-sitter through web-tree-sitter and prebuilt grammar wasm

- Status: Accepted
- Date: 2026-10-28

## Context

ImpactGate (spec 5G) and the planned control-flow visualizer (`Shift+p`, spec 5D) need concrete syntax trees for TypeScript, TSX and JavaScript first, with more languages later. ADR 0004 rules out native addons, so the `tree-sitter` Node bindings are out. The WebAssembly options:

- `tree-sitter-typescript` / `tree-sitter-javascript` from npm ship `.wasm` files, but depend on `node-addon-api` and `node-gyp-build` and run a native install step, which is what ADR 0004 avoids.
- `tree-sitter-wasms` (Unlicense, one maintainer, 52 MB, grammars of mixed ages) is not maintained closely enough to bet on.
- `@vscode/tree-sitter-wasm` (MIT, Microsoft, no dependencies or install scripts) is the set VS Code ships: grammars built in CI from the upstream packages (TypeScript and TSX 0.23.2, JavaScript 0.25.0, plus about a dozen others). Its own runtime is a UMD wrapper of web-tree-sitter 0.25 that reads `__filename` when it loads, which throws inside our ESM main bundle.
- `web-tree-sitter` (MIT, the upstream project's own binding) is an ESM module that locates itself with `import.meta.url` and has no dependencies.

## Decision

- Add `web-tree-sitter@0.27.1` for the runtime and `@vscode/tree-sitter-wasm@0.3.1` for the grammar files only, both pinned exactly as runtime dependencies. The grammars are ABI 14 and 15; the runtime loads ABI 13 to 15. They are upgraded together, and the syntax domain's tests parse each grammar, so a mismatch fails `npm run check`.
- A new `src/internal/syntax/` domain owns parsing. `grammars.ts` maps a language id to its wasm file and extensions, so a new language is a data change. `createSyntaxParser({ wasmDirectory?, maxSourceLength? })` initializes the runtime once per process and loads each grammar on first use. `parse(path, text, use)` detects the language by extension, parses, calls `use(root, language)` and frees the tree when `use` returns, so no tree can leak WebAssembly memory. Nodes are exposed as a narrow `SyntaxNode` interface, not web-tree-sitter's classes.
- **Runtime assets.** esbuild bundles the JavaScript but not the `.wasm` files. `listWasmAssets()` lists every file needed (the runtime's `web-tree-sitter.wasm` and one per grammar) with its resolved path in `node_modules`. The build copies them to `dist/main/wasm/`, and main passes `wasmDirectory: path.join(import.meta.dirname, 'wasm')`. Without `wasmDirectory` the files load from `node_modules`, which is how Vitest and plain Node run. The files are about 3.5 MB together.
- Sources longer than 1,000,000 characters are refused (`too-large`) by default. Syntax errors are not failures: tree-sitter always returns a tree, and `hasError` flags it.

## Consequences

Two runtime dependencies (about 27 MB in `node_modules`, mostly grammars we don't ship) and no native build. Parsing is synchronous on the calling thread once a grammar has loaded, and parsing plus a full walk costs about 0.75 s per MB of source, so a review of a few hundred ordinary files takes well under a second. Huge or generated files are skipped, and moving parsing to a `worker_thread` is the next step if the main process stalls. The runtime's one-instance-per-process rule means the first `wasmDirectory` wins. Other domains never import `web-tree-sitter`; they declare the node shape they need (ADR 0015) and main hands them trees.
