# 0017. Language server discovery, workspace trust and lifecycle

- Status: Accepted
- Date: 2026-10-28

## Context

Language servers run code. beuve reviews branches written by agents or strangers, so the worktree is untrusted input: a pull request can commit `node_modules/.bin/typescript-language-server` or `node_modules/typescript/lib/tsserver.js`, and running either would execute the code under review merely by opening it. Servers also spawn their own children (tsserver), can crash or hang, and hold memory while idle.

## Decision

- **Registry as data**: a `ServerDefinition` names the command, arguments, file extension → language id map, `initializationOptions`, settings, extra environment and a diagnostics quiet period. `typescriptServerDefinition()` covers TypeScript and JavaScript with automatic type acquisition and tsserver logging off.
- **Discovery** (`findServerCommand`): an absolute command is used as is; a bare name is looked up in the caller's search directories (beuve's own `node_modules/.bin`, passed in by main), then absolute `PATH` entries. The workspace's `node_modules/.bin` is searched, first, only with `trustWorkspaceBinaries`, which is off by default. For untrusted workspaces main also pins `tsserverPath` to beuve's own TypeScript; otherwise `typescript-language-server` prefers the workspace's.
- **Spawning**: no shell, `cwd` = the workspace root's real path, an allow-listed environment (`PATH`, `HOME`, temp, locale and a few platform variables; never `NODE_OPTIONS`, `ELECTRON_*` or tokens), and on POSIX its own process group so the whole tree can be reaped.
- **Paths**: roots and file paths are untrusted; roots are realpath-resolved directories, files must resolve (after symlinks) inside the root, and only files inside the root are ever read.
- **Lifecycle** (`createLspMultiplexer`): one process per (real root, server id), started on first use. After `idleTimeoutMs` (5 minutes) without use a server is shut down and restarts on demand. Unexpected exits fail in-flight work with `server-exited` and restart lazily on the next call; more than `maxRestarts` (3) crashes or failed starts within `restartWindowMs` (5 minutes) refuse with `restartsExhausted` until the window passes. `dispose` sends `shutdown` and `exit`, then SIGTERM and SIGKILL to the process group if needed. Servers get `processId` so they exit if beuve dies.

## Consequences

Opening a review never runs repository-controlled executables unless main opts in for a trusted local checkout, at the cost of diagnostics from beuve's TypeScript version rather than the project's. Packaged builds must ship (or locate) `typescript-language-server` and TypeScript, and because macOS GUI apps get a minimal `PATH`, main should launch the server's CLI with Electron's own Node (`command: process.execPath`, `leadingArgs: [cli]`, `env: { ELECTRON_RUN_AS_NODE: '1' }`). Windows has no process-group reaping.
