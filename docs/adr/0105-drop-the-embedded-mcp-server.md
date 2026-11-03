# 0105. Drop the embedded MCP server

- Status: Accepted
- Date: 2026-11-03

## Context

ADR 0011 gave beuve an MCP server (spec 5C) on `127.0.0.1`, so a coding agent in another process could reach the reviewer's live session. ADR 0021 and 0027 wired two tools to it: `beuve_get_lsp_diagnostics`, so an agent could check its own work against the session head, and `beuve_read_human_review`, the staged review as `beuve.ura/1` JSON plus XML.

The reviewer is not sure the live channel is worth having. The same review already leaves beuve as text: the dock's "Copy for Claude Code (XML)" button and the `agent-json` and `agent-xml` export targets (ADR 0023, 0027), and making that copy-and-paste path easy is the direction of travel. An agent that has to be configured with a bearer token and a port to read what the reviewer could paste is a worse deal than the paste.

The server also costs more than it shows. It is a network listener (loopback, but a listener), a bearer token and a discovery file in `userData`, a port setting, the MCP SDK and its HTTP stack in the main bundle, a status-bar indicator, an IPC channel, and a seam (`MainServices.mcpTools`) that several domains had to serve.

## Decision

- **The MCP server is removed.** `src/main/mcp/` goes, with the `mcp:status` event and `McpStatus`, the status bar's MCP indicator, the `BEUVE_MCP_PORT` variable (and the dev scripts that set it) and `@modelcontextprotocol/sdk` as a direct dependency. The lockfile loses only that root entry: the package stays installed because the Claude Agent SDK depends on it.
- **What existed only for the tools goes too:** `MainServices.mcpTools`, `LspServices.diagnostics` and its agent-facing report types, `UraServices.readAgentReview`, `GithubServices.summaryFor` (the pull request identity that only the MCP payload carried), and `resolveSessionId` (the "open session, else the only session" rule of ADR 0021). `startApp` no longer awaits anything, so it is synchronous.
- **Kept on purpose:**
  - The `beuve.ura/1` JSON and XML exports, which are the paste path.
  - The language-server multiplexer's `getDiagnostics` in `src/internal/lsp`: a domain primitive with its own tests, ready for any later consumer.
  - `mcp-token` and `mcp-server.json` on `secureUserData`'s list. beuve no longer writes them, but older installs may still hold them, and the list keeps them owner-only. beuve does not delete them.
  - beuve's own Claude Code runs still start with no MCP servers (`--strict-mcp-config`, ADR 0019): the worktree is untrusted input, which has nothing to do with the server beuve used to offer.
- **ADR 0011 stands except for its MCP transport**, so the IPC contract layer and the CSP decision are unchanged. ADR 0021's MCP tools and session resolution and ADR 0027's `beuve_read_human_review` are superseded by this ADR. The spec (section 5C) notes the removal.
- **Tests** that read the review through `mcpTools` now read it through `ura.export`. The two main-services integration tests that used diagnostics to start a checkout use `lsp.hover` instead.

## Consequences

- One listener, one token, one discovery file, one IPC channel and one dependency edge fewer. The status bar loses its rightmost readout, and `dist/main/index.js` shrinks by about 0.7 MB (3.86 MB to 3.16 MB).
- Agents can no longer read the review or ask for diagnostics without the reviewer's hands. Review feedback reaches an agent by paste.
- The exported review no longer has a path to carry the pull request's number, title, URL, state and author, which only the MCP payload added. If pasted reviews should say which pull request they are about, the export needs it.
- Nothing in `src/main` exercises language-server diagnostics end to end any more; only the multiplexer's own tests do.
- Bringing the server back needs a new ADR. ADR 0011's reasoning (Streamable HTTP on loopback rather than stdio, because a spawned stdio server can't see the running app's session) is the place to start, and the implementation is in git history before this ADR.
