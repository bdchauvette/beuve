# 0083. The runAsNode fuse is off; Node children run a bundled Node

- Status: Accepted
- Date: 2026-10-31

## Context

beuve runs two Node programs as children: `typescript-language-server` with its tsservers (ADR 0017, 0021) and the reviewed repository's Vitest for trace probes (ADR 0036). Both ran as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so the packaged app kept Electron's `runAsNode` fuse on (ADR 0048). With that fuse on, anything running as the user can start `beuve.app` as a Node interpreter and run arbitrary code under beuve's code signature, Keychain ACL entry (the `safeStorage` key) and TCC grants.

The options, all tried in a packaged Linux build with the fuse off (investigation of 2026-10-30):

- **`utilityProcess`**: no stdin, so LSP over stdio needs a bridge. A utility process can't be its own process group, so cancelling a probe can't kill the tests' children. With the fuse off, `child_process.fork` throws inside it. tsserver is started with `fork`, and so is Vitest's default `forks` pool. Working around this needs monkey-patches of a bundled third-party CLI, and `--pool=threads` changes how the reviewed repository's tests behave: `process.chdir` throws, and `spawn(process.execPath)` starts beuve. Probe results would then differ from the repository's own CI.
- **System `node`**: versions drift (Node 22 lacks `Temporal`, which the probe's setup module uses), and a macOS app opened from Finder doesn't see Homebrew, nvm or volta on `PATH`.
- **A bundled standalone Node**: about 45 MB more per macOS download. Processes, process groups, Vitest's pools and tsserver behave exactly as before.

## Decision

- **`electronFuses.runAsNode: false`.** `electron-builder.yml` keeps the other fuses as they were. `grantFileProtocolExtraPrivileges` stays on: with it off, the packaged app can't load `app.asar/dist/ui/index.html` (`ERR_FILE_NOT_FOUND`), and turning it off needs a custom protocol first. Electron's ninth fuse (`WasmTrapHandlers`) can't be set through electron-builder and keeps Electron's default (on).
- **Packaged builds ship Node** as `resources/node/node`: the official nodejs.org binary for `darwin-arm64` and `linux-x64`, pinned and verified (ADR 0084), and on macOS kept with its own signature (ADR 0085). `npm run dist:*` runs `scripts/fetch-node.ts` first. It downloads the archive into `vendor/node/` (gitignored) and extracts only `bin/node`.
- **One resolver, `resolveNodeRuntime`** (`src/main/node-runtime/`), called once in `launch()`:
  - A packaged app uses only `<resourcesPath>/node/node` and never falls back to `PATH`.
  - `npm start` and tests use the first executable `node` on `PATH`.
  - The binary runs `--version` once, with an empty environment, and anything below Node 26 is refused.
  - The result is a typed `Result`: `missing`, `unrunnable` or `too-old`, with a message from `describeNodeRuntimeError`.
  - `createMainServices` requires it. The TypeScript language server definition and the Vitest trace runner take its `command` and spawn it with a plain `spawn`. Process groups, cancellation and `using` cleanup are unchanged.
  - Without a usable Node, TypeScript gets no language server, every probe fails with the resolver's message, and main logs the error at startup.
- **No `ELECTRON_RUN_AS_NODE` and no `child_process.fork` in `src/main` or `src/internal`.** `local/no-electron-as-node` reports the variable's name anywhere in shipped code (tests may name it, to check that environments drop it) and `fork` from `child_process`. With the fuse off, Electron's `fork` throws in a packaged app.
- **`scripts/check-packaged-app.ts`** (`npm run check:packaged -- --app <app>`) reads the fuse wire from the built binary (the `Electron Framework` on macOS) without `@electron/fuses`. It fails unless every fuse matches `electron-builder.yml`, and unless the bundled Node prints the pinned version and has `Temporal`. CI runs it on Linux (`dist:linux-dir`) and macOS (`dist:mac`), and the release workflow runs it on the artifact it ships.
- This supersedes the launch-path parts of ADR 0017, 0021, 0036 and 0048 ("runs as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`", "`runAsNode` stays on").

## Consequences

- Another process can no longer run code as beuve through its binary.
- The bundled Node has its own code identity. It isn't on beuve's Keychain ACL, and TCC grants for `dev.amoskeag.beuve` don't attach when another process runs it directly.
- Probes now run on the same Node as beuve's own tests and CI (26), not on Electron's 24.
- Costs:
  - the download and the app on disk grow (measured in `docs/packaging.md`);
  - packaging needs a network fetch, cached after the first one;
  - beuve has to bump Node for Node security releases (ADR 0084).
- Dev and packaged builds run different Node binaries, but both are ≥ 26, and the packaged check runs in CI.
- A dependency that starts calling `fork` in main would throw only in a packaged app. The lint rule covers beuve's own code; the packaged smoke covers the rest only as far as it exercises it.
