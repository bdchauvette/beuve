# 0004. Built-in node:sqlite instead of better-sqlite3

- Status: Accepted
- Date: 2026-10-28

## Context

The spec uses better-sqlite3, a native addon that must be rebuilt against Electron's ABI on every Electron upgrade and complicates CI and packaging. Electron 45 ships Node 24, which includes `node:sqlite` (`DatabaseSync`) with a similar synchronous API.

## Decision

Use `node:sqlite`. Access it through thin helpers in `#pkg/sqlite/` (connection opening, migrations, transactions) so the rest of the code doesn't depend on the module's exact surface.

## Consequences

No native build step and one fewer dependency. `node:sqlite` is still marked release-candidate in Node 24 and may emit an experimental warning; the `#pkg/sqlite` wrapper confines any API churn to one place. The database file lives under `app.getPath('userData')`, not `~/.review-workbench`.
