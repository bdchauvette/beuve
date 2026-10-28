# 0016. In-house JSON-RPC and LSP client, read-only by construction

- Status: Accepted
- Date: 2026-10-28

## Context

The `lsp` domain feeds `beuve_get_lsp_diagnostics` (spec 5C) and call-stack peek portals (spec 5D) from real language servers. The usual client stack (`vscode-jsonrpc`, `vscode-languageserver-protocol`, `vscode-languageclient`) is several packages, assumes an editor that owns documents and applies edits, and is far larger than the slice of LSP a review tool needs. Spec principle D prefers small transparent code over dependencies, and beuve is authoring-resistant (spec 1).

## Decision

- **Framing and JSON-RPC 2.0 in `src/pkg/jsonrpc/`**, Node built-ins only, knowing nothing of LSP: `ContentLengthDecoder` (streaming, robust to any chunk split including inside headers and multi-byte characters, bounded header and body sizes, O(1) copies per byte), `encodeMessage`, `parseMessage` and `JsonRpcConnection` (correlation, per-request timeouts, `AbortSignal` cancellation with a configurable cancel notification, peer requests and notifications, every pending request settled when the stream closes). Nothing rejects; failures are `Result`s.
- **LSP specifics in `src/internal/lsp/`**: hand-written types for the subset used (`lsp-protocol.ts`), guards that check every server value before use, and a public model (`lsp-model.ts`) of plain serializable data.
- **Positions**: the model uses 0-based lines and UTF-16 columns (JavaScript string indices). The client offers `general.positionEncodings` `utf-16`, `utf-8`, `utf-32` and converts per line when a server picks another (`convertCharacter`, `LineIndex`, which treats `\r\n`, `\n` and `\r` as line ends). Columns in files outside the workspace root that aren't open are passed through unconverted.
- **Read-only stance**: client capabilities never advertise `workspace.applyEdit`, `workspaceEdit`, rename, code actions, formatting, completion or file operations. Server requests get minimal answers: `workspace/applyEdit` → `{ applied: false }`, `workspace/configuration` from the server definition's settings, progress creation, registrations and refreshes acknowledged and ignored, `window/showDocument` declined, everything else "method not found". The client never sends edits or saves; documents are opened from disk text with full-text sync and versions.
- **Diagnostics settle** by pull (`textDocument/diagnostic`) when the server offers it, otherwise by waiting for the first push report after the document's latest sync (respecting its `version`), then a per-server quiet period with no work-done progress active. Each request re-sends the file under a new version so dependencies changed on disk are re-checked. If the old report stands and nothing arrives within a grace period, the result is marked `assumed-unchanged`; at the deadline, `timed-out`.

## Consequences

No protocol dependency and a small surface that is fully tested, including byte-level property tests of the decoder. We maintain the LSP types ourselves and add them as features need them. Diagnostics carry an explicit freshness rather than a false promise: servers like `typescript-language-server` skip publishing an unchanged empty report, so a clean file costs the grace period (1.5 s by default) per call, and a server slower than the grace period on a previously clean file can be reported clean with `assumed-unchanged`.
