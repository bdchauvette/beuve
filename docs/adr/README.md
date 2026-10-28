# Architecture Decision Records

Lightweight ADRs capturing decisions as the project evolves. One file per decision, numbered sequentially, never renumbered. To change a decision, add a new ADR that supersedes the old one and update the old one's status.

Template: [0000-template.md](0000-template.md)

| ADR                                                           | Title                                                               | Status   |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                 | Record architecture decisions                                       | Accepted |
| [0002](0002-modular-monolith-import-rules.md)                 | Modular monolith layout and import rules                            | Accepted |
| [0003](0003-lit-for-ui-layer.md)                              | Lit for the UI layer                                                | Accepted |
| [0004](0004-node-sqlite.md)                                   | Built-in node:sqlite instead of better-sqlite3                      | Accepted |
| [0005](0005-electron-security-baseline.md)                    | Electron security baseline without eslint-plugin-electron           | Accepted |
| [0006](0006-domain-owned-persistence.md)                      | Domains own their tables; main composes                             | Accepted |
| [0007](0007-build-test-and-tooling-layout.md)                 | Build, test and tooling layout                                      | Accepted |
| [0008](0008-ts-extension-import-specifiers.md)                | Import specifiers use the `.ts` extension                           | Accepted |
| [0009](0009-session-domain-model.md)                          | Session domain model                                                | Accepted |
| [0010](0010-git-cli-and-interdiff.md)                         | Git CLI and interdiff algorithm                                     | Accepted |
| [0011](0011-ipc-contract-and-mcp-transport.md)                | IPC contract layer and MCP transport                                | Accepted |
| [0012](0012-checkpoint-base-and-review-composition.md)        | Checkpoints record the reviewed base; main composes session and git | Accepted |
| [0013](0013-test-helpers-in-testing-directories.md)           | Shared test helpers live in `testing/` directories                  | Accepted |
| [0014](0014-tree-sitter-via-web-tree-sitter.md)               | Tree-sitter via web-tree-sitter                                     | Accepted |
| [0015](0015-impactgate-metrics-and-syntax-seam.md)            | ImpactGate metrics and the syntax seam                              | Accepted |
| [0016](0016-in-house-lsp-client-read-only.md)                 | In-house read-only LSP client                                       | Accepted |
| [0017](0017-language-server-discovery-trust-and-lifecycle.md) | Language server discovery, trust and lifecycle                      | Accepted |
| [0018](0018-pierre-diffs-and-trees-integration.md)            | @pierre/diffs and @pierre/trees integration                         | Accepted |
