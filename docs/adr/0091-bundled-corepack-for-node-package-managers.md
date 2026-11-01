# 0091. Bundled corepack runs Node package managers on beuve's Node

- Status: Superseded by [0095](0095-terminal-panel-in-the-session-checkout.md)
- Date: 2026-11-01

## Context

Dependency installs (ADR 0089) need npm, pnpm and yarn. A Finder-launched app has no `PATH` to them, the user's versions may not match what a repository pins, and the package manager's version matters: npm 10 refuses a lockfile npm 11 wrote (research, on beuve's own repository). beuve's bundled Node (ADR 0083) is only `bin/node`, without npm or corepack. corepack fetches the package manager a project pins in `packageManager` (verifying its `+sha512` hash) or a known-good default, and has no dependencies. CLAUDE.md requires an ADR for a new dependency.

## Decision

- **Dependency**: `corepack` 0.36.0 (2026-08-28), pinned exactly in `package.json`. No dependencies, about 0.8 MB.
- **Packaging**: `electron-builder.yml` copies `node_modules/corepack` (`package.json`, `LICENSE.md`, `dist/**`) and unpacks it from the archive (`asarUnpack`), because the bundled Node runs `dist/corepack.js` by path and can't read inside `app.asar`. `resolveCorepack` finds it with `require.resolve` and `unpackedPathFrom`, beside `resolveNodeRuntime`'s Node. `scripts/check-packaged-app.ts` runs the unpacked script with the bundled Node and fails when its version isn't the pinned one, so `npm run dist:linux-dir` and the macOS packaging job check it.
- **Use**: a Node row's command is `[node, corepack.js, <npm|pnpm|yarn>]`, run in the unit's directory, so corepack honours `packageManager` (and refuses a project that pins another manager, as in a terminal). `COREPACK_HOME` is `<userData>/deps/corepack` (0700); `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` and `COREPACK_ENABLE_AUTO_PIN=0` keep it non-interactive and from editing `package.json`. The tool's `PATH` starts with beuve's Node, so lifecycle scripts that run `node` get it.
- **Override**: a directory set for `npm`, `pnpm` or `yarn` in Settings (ADR 0089) runs that executable instead.
- **bun** is a native binary corepack can't fetch; it stays a host tool.
- **Version policy** (amends ADR 0084): corepack is bumped deliberately, like the bundled Node, in its own commit, after checking the new version on the CI Node and in the packaged app. Unpackaged (`npm start`, tests) it runs on the `node` on `PATH`, as language servers do.

## Consequences

Node installs work without any Node tooling on the machine and use the version the repository pins, downloaded once per version into `COREPACK_HOME`. A first install of a pinned manager needs the network. Native addons built by install scripts target beuve's Node ABI, which is also what trace probes run on (ADR 0083). Installing corepack in beuve's own `node_modules` also adds `pnpm` and `yarn` shims to its `node_modules/.bin`, which nothing in beuve's scripts uses.
