# 0096. Drop trace probes and the trust grant; copy a relative line number instead

- Status: Accepted
- Date: 2026-11-01

## Context

ADR 0036 and 0041 built trace probes: instrument the functions around a hunk through a Vitest transform, run the tests that cover it, and show an execution timeline in the diff and through the `beuve_run_trace_probe` MCP tool. It runs only for Vitest, instruments one file per probe, and takes 0.6 to 1.2 s a run where the spec asked for 200 ms. It also carries a large amount of code: the planner and recorder in `src/internal/trace`, the runner and services in `src/main/trace`, the portal in the renderer, an IPC channel pair and an event, an MCP tool, and a scratch directory in `userData`.

The per-repository trust grant (ADR 0090) existed to gate running a repository's tests for probes and, until ADR 0095, dependency installs. With installs gone and the terminal panel in place (the reviewer runs what they choose, in their own shell), probes were its only consumer.

The reviewer can already run a test in the terminal panel. What is missing is a fast way to name the test: runners such as Vitest, pytest and RSpec take `path:line`.

## Decision

- **Trace probes are removed**: `src/internal/trace`, `src/main/trace`, the portal and its state in `src/ui`, `trace:run`, `trace:cancel`, `trace:status`, the `trace` command (formerly Cmd+R), and `beuve_run_trace_probe`. The MCP server keeps `beuve_get_lsp_diagnostics`, `beuve_run_impact_check` and `beuve_read_human_review`.
- **The trust grant is removed with its only consumer**: `src/internal/trust`, `src/main/trust`, the trust dialog, the "Trusted repositories" list in Settings, `trust:get`, `trust:set`, `trust:list`, `trust:remove`, the `trust` and `untrust` commands and the `/trust` and `/untrust` chat commands. A migration in `src/main/database/retired-migrations.ts` drops `trust_grants`. A future feature that runs repository code reintroduces trust with its own ADR.
- **Copy Relative Line Number** (Edit menu, `Alt+Shift+Cmd+C` on macOS, `Ctrl+Alt+Shift+C` elsewhere) copies the review target's repository-relative path and head line as `path:line`, for example `src/a.test.ts:42`. It takes the line from the same target as Open in Editor (ADR 0063, `lineFromTarget`): a selection's first head line, a hunk's first change, a jump's line, or a file's first change. A target with no head line, such as a deleted file, copies the path alone.
- **A test runner is future work**: a generic runner, possibly driven by language servers, can come later behind its own ADR. Nothing here constrains it.
- The bundled Node (ADR 0083) stays: the TypeScript language server needs it. The `trace` directory stays on `secureUserData`'s list because older installs may still have one.

## Consequences

- About 80 files and several thousand lines go, with the `trace:*` and `trust:*` IPC surface and the recorder's lint exception.
- Runtime tracing of a hunk is gone, and so is the agent-facing probe. An agent that wants execution evidence runs the tests itself.
- Stored approvals (the `trust_grants` table and the older `traceTrustedRepositories` settings key) are ignored; the table is dropped on the next start. The settings key is left in `settings.json` as unread data.
- ADR 0036, 0041 and 0090 are superseded; their text stays as the record. Amendments to them in ADR 0033, 0089 and 0095 that mention probes describe a feature that no longer exists.
