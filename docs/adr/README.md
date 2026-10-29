# Architecture Decision Records

Lightweight ADRs capturing decisions as the project evolves. One file per decision, numbered sequentially, never renumbered. To change a decision, add a new ADR that supersedes the old one and update the old one's status.

Template: [0000-template.md](0000-template.md)

| ADR                                                                   | Title                                                                            | Status   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                         | Record architecture decisions                                                    | Accepted |
| [0002](0002-modular-monolith-import-rules.md)                         | Modular monolith layout and import rules                                         | Accepted |
| [0003](0003-lit-for-ui-layer.md)                                      | Lit for the UI layer                                                             | Accepted |
| [0004](0004-node-sqlite.md)                                           | Built-in node:sqlite instead of better-sqlite3                                   | Accepted |
| [0005](0005-electron-security-baseline.md)                            | Electron security baseline without eslint-plugin-electron                        | Accepted |
| [0006](0006-domain-owned-persistence.md)                              | Domains own their tables; main composes                                          | Accepted |
| [0007](0007-build-test-and-tooling-layout.md)                         | Build, test and tooling layout                                                   | Accepted |
| [0008](0008-ts-extension-import-specifiers.md)                        | Import specifiers use the `.ts` extension                                        | Accepted |
| [0009](0009-session-domain-model.md)                                  | Session domain model                                                             | Accepted |
| [0010](0010-git-cli-and-interdiff.md)                                 | Git CLI and interdiff algorithm                                                  | Accepted |
| [0011](0011-ipc-contract-and-mcp-transport.md)                        | IPC contract layer and MCP transport                                             | Accepted |
| [0012](0012-checkpoint-base-and-review-composition.md)                | Checkpoints record the reviewed base; main composes session and git              | Accepted |
| [0013](0013-test-helpers-in-testing-directories.md)                   | Shared test helpers live in `testing/` directories                               | Accepted |
| [0014](0014-tree-sitter-via-web-tree-sitter.md)                       | Tree-sitter via web-tree-sitter                                                  | Accepted |
| [0015](0015-impactgate-metrics-and-syntax-seam.md)                    | ImpactGate metrics and the syntax seam                                           | Accepted |
| [0016](0016-in-house-lsp-client-read-only.md)                         | In-house read-only LSP client                                                    | Accepted |
| [0017](0017-language-server-discovery-trust-and-lifecycle.md)         | Language server discovery, trust and lifecycle                                   | Accepted |
| [0018](0018-pierre-diffs-and-trees-integration.md)                    | @pierre/diffs and @pierre/trees integration                                      | Accepted |
| [0019](0019-review-model-port-and-claude-code-cli-adapter.md)         | Review model port and Claude Code CLI adapter                                    | Accepted |
| [0020](0020-session-head-worktrees.md)                                | Session head checkouts in beuve-owned worktrees                                  | Accepted |
| [0021](0021-impactgate-and-lsp-wiring.md)                             | Wiring ImpactGate and language servers into main                                 | Accepted |
| [0022](0022-opt-in-preliminary-review-via-chat-command.md)            | Opt-in preliminary review, run from a chat command                               | Accepted |
| [0023](0023-universal-review-artifact-model-and-exporters.md)         | Universal Review Artifact model and exporters                                    | Accepted |
| [0024](0024-review-runs-keyed-by-path-scope.md)                       | Review runs keyed by path scope; statuses survive reruns                         | Accepted |
| [0025](0025-diff-cards-themes-and-lazy-mounting.md)                   | Diff cards: Alabaster-style themes, curated grammars and lazy mounting           | Accepted |
| [0026](0026-radar-tree-and-file-channels.md)                          | The package-aware radar tree and the file channels behind it                     | Accepted |
| [0027](0027-ura-dock-keyboard-clipboard-and-outdated-items.md)        | The URA dock: wiring, keyboard grammar, clipboard path and outdated items        | Accepted |
| [0028](0028-control-flow-graphs-and-layout.md)                        | Control-flow graphs and layout                                                   | Accepted |
| [0029](0029-flow-graph-channel-and-persisted-verdict.md)              | The flow graph channel, its portal, and the persisted reviewer verdict           | Accepted |
| [0030](0030-llm-domain-and-structural-model-ports.md)                 | The llm domain and structural model ports                                        | Accepted |
| [0031](0031-read-only-qa-chat.md)                                     | Read-only Q&A chat                                                               | Accepted |
| [0032](0032-chat-wiring-one-answer-per-session.md)                    | Chat wiring: one answer per session, refused not queued                          | Accepted |
| [0033](0033-open-in-editor.md)                                        | Opening the current line in the reviewer's editor                                | Accepted |
| [0034](0034-github-credential-provider-and-gh-cli-adapter.md)         | GitHub credential provider and gh CLI adapter                                    | Accepted |
| [0035](0035-github-rest-client-scope.md)                              | GitHub REST client scope                                                         | Accepted |
| [0036](0036-test-driven-trace-probes.md)                              | Test-driven trace probes                                                         | Accepted |
| [0037](0037-github-pull-request-sessions-and-local-clones.md)         | GitHub pull request sessions, local clones and stored metadata                   | Accepted |
| [0038](0038-github-polling-policy.md)                                 | Polling an open pull request session                                             | Accepted |
| [0039](0039-posting-reviews-and-posted-items.md)                      | Posting the URA as a GitHub review, and posted items                             | Accepted |
| [0040](0040-github-in-the-renderer-and-development-overrides.md)      | GitHub in the renderer, safe links and development overrides                     | Accepted |
| [0041](0041-trace-probe-trust-channels-and-cancellation.md)           | Trace probes in the app: trust, channels, cancellation and the MCP tool          | Accepted |
| [0042](0042-diff-display-modes-whitespace-variant-and-impact-chip.md) | Diff display modes, the whitespace-ignoring variant, and the ImpactGate chip     | Accepted |
| [0043](0043-inline-edits-become-suggestions.md)                       | Inline edits become suggested patches, never writes                              | Accepted |
| [0044](0044-two-column-shell-open-flow-and-command-palette.md)        | Two-column shell, one open flow, and a command palette over one registry         | Accepted |
| [0045](0045-verdict-choice-belongs-to-a-head.md)                      | A chosen verdict belongs to the head it was chosen at                            | Accepted |
| [0046](0046-chat-context-mentions.md)                                 | Chat context mentions: grammar, resolution at the commit, budget and persistence | Accepted |
| [0047](0047-chat-compaction.md)                                       | `/compact`: a summary message as the chat's compaction boundary                  | Accepted |
| [0048](0048-packaging-signing-and-release.md)                         | Packaging, signing and release with electron-builder                             | Accepted |
