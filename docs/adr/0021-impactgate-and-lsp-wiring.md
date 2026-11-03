# 0021. Wiring ImpactGate and language servers into main

- Status: Accepted; the ImpactGate wiring is superseded by [0102](0102-drop-impactgate-and-credit-its-sources.md) and the MCP tools by [0105](0105-drop-the-embedded-mcp-server.md)
- Date: 2026-10-28

## Context

The syntax, impact and lsp domains (ADRs 0014 to 0017) exist but nothing reaches them. ImpactGate needs base and head text for each diff file, which the review's diff names only by blob id, and parsing a large review must not slow down `session:get-review`. Agents call the MCP tools without knowing beuve's session ids, and expect the line numbers editors and compilers print. The language server must start in a packaged app whose GUI `PATH` may have no `node`.

## Decision

- **Blobs** come from `readBlobs` in the git domain: one `git cat-file --batch-check` for types and sizes, then one `git cat-file --batch` for the text blobs within 1 MiB, parsed by byte count. Two processes per review instead of one per file (hundreds of spawns for a large review), and no long-lived process to keep in step. Outcomes are typed: `text`, `binary` (a NUL in the first 8000 bytes), `too-large`, `submodule` (mode `160000`, never read), `missing`, `not-a-blob`. The runner gained stdin input and raw-byte output (`execGit`, `GitRepository.exec`) with the same hardening.
- **`session:get-impact { sessionId }`** is its own channel: the renderer asks after the review has rendered. Main recomputes the review's diff (a few git spawns), and caches the report per (session, reviewed-from head, base, head) in an LRU of 32, sharing in-flight computations and not caching failures. Files ImpactGate has no rules for, binaries and submodules are skipped before any blob is read. The DTO mirrors `ImpactReport` with the skip reasons `binary` and `submodule` added, plus `computeMs`.
- **`lsp:call-hierarchy { sessionId, path, line, character?, direction, nodeId? }`** uses 1-based lines like the rest of the contract (the LSP model is 0-based). Without `character` the root is the function enclosing the line (`documentSymbols` + `findEnclosingSymbol`). Nodes are badged with `badgeCallHierarchyNode` against head-side changed lines: runs of added lines, and the two lines either side of a deletion; context lines don't count.
- **MCP tools**: when `sessionId` is omitted, the tools use the session the reviewer last opened in this run of beuve, else the only stored session; with several and none open they fail with the candidate ids. Results carry `structuredContent` as well as the JSON text. `beuve_get_lsp_diagnostics` reports 1-based lines and columns (UTF-16), says so in its description, and accepts absolute paths inside the repository. `beuve_run_impact_check` narrows to `paths` after computing the whole (cached) review, so percentiles still rank against the whole review.
- **Language server**: one multiplexer, created by `createMainServices` and disposed on quit. The TypeScript definition runs beuve's own `typescript-language-server/lib/cli.mjs` and pins `typescript/lib/tsserver.js`, with `command: process.execPath` and `ELECTRON_RUN_AS_NODE=1`: Electron's Node in the app, plain Node in tests. `trustWorkspaceBinaries` stays false.
- **Wasm**: the build copies `listWasmAssets()` to `dist/main/wasm/` and main passes that directory to `createSyntaxParser`.

## Consequences

The review renders before any parsing, and a repeated impact request costs only the git diff. Packaging ships `typescript-language-server` and `typescript`: main resolves both from `node_modules` at run time (`require.resolve`), so they are `dependencies`, not devDependencies. The open-session default is per process and in memory, so after a restart an agent with several sessions must pass `sessionId` until the reviewer opens one. Call hierarchy node ids expire with the multiplexer's LRU and when a head change removes the checkout they were found in; the UI then has to peek again.
