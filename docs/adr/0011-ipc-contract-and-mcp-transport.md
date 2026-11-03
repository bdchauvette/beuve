# 0011. Typed IPC contract layer and localhost MCP transport

- Status: Accepted; the MCP transport is superseded by [0106](0106-drop-the-embedded-mcp-server.md)
- Date: 2026-10-28

## Context

main, preload and ui run in three processes but must agree on channel names and payloads. ADR 0002 forbids ui and preload from importing main, so the shared types need a home of their own. Separately, the embedded MCP server (spec 5C) needs a transport that agents running as separate processes can reach, and the renderer needs a Content-Security-Policy (ADR 0005) that fits how it is loaded.

## Decision

- **`src/contract/`** is a new top-level layer holding the IPC contract: an `InvokeChannelMap` of request/response types per `ipcRenderer.invoke` channel, an `EventChannelMap` of push payloads, the `BeuveApi` type of `window.beuve`, and runtime channel allow-lists. It may import only itself and `src/pkg`, and nothing it reaches may use a Node built-in, because it is bundled into the sandboxed preload and the renderer. main, preload and ui may import it; domains may not. dependency-cruiser enforces this (`contract-is-leaf`, `contract-is-node-free`). DTOs are plain serializable data (no brands), mapped from domain types by adapters in `src/main`.
- Every invoke response is a `Result<T, IpcError>`; expected failures (`invalid-request`, `not-wired`, `not-found`) never reject. main validates each renderer argument with zod and refuses calls from frames other than the app's own top-level page. The preload re-checks channel names against the allow-list and exposes only `invoke` and `on`, never `ipcRenderer`.
- **MCP over Streamable HTTP on 127.0.0.1**, stateless (one server and transport per request), instead of stdio. A stdio server is spawned by its client and would have no access to the reviewer's live session in the running app. The endpoint is `http://127.0.0.1:<port>/mcp`, on `BEUVE_MCP_PORT` or 47291 by default, falling back to an ephemeral port if that one is taken.
- Every request must carry `Authorization: Bearer <token>`, a 256-bit random token persisted in `<userData>/mcp-token` (mode 0600). Requests whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>`, or that carry any `Origin` other than those, are rejected with 403 (DNS-rebinding and drive-by browser defence) before the token is checked.
- **Discovery**: while the server runs, `<userData>/mcp-server.json` (0600, written atomically, removed on quit) holds `{ schemaVersion: 1, name, transport: "streamable-http", url, token, pid, startedAt }`, so agents and CLIs can find the server and authenticate. The token never crosses into the renderer; `mcp:status` carries only state and URL.
- **CSP stays a `<meta>` tag** in `src/ui/index.html`. The renderer is loaded with `loadFile`, and `file://` responses have no headers to attach a policy to. Defence in depth: the default session cancels every http(s)/ws(s) request and denies all permission requests. If we move to a custom `app://` protocol, the policy becomes a response header there.

## Consequences

Adding a channel means one map entry, one allow-list entry (a type test catches omissions), one zod schema and one handler. Imports of `src/contract` use the `#contract/*` alias (package.json `imports`), as `#pkg/*` and `#internal/*` do. The main bundle carries the MCP SDK and its HTTP stack (about 1.4 MB). Agents must read the discovery file or be configured with the token. The default port is stable across restarts, but the port in the discovery file is the authoritative one.
