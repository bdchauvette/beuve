# beuve contributor guide

Electron + Node + TypeScript + Lit code-review workbench. Read `docs/architecture-spec.md`, then `docs/adr/` (ADRs override the spec).

## Before committing

- Run `npm run check` (typecheck, lint, format:check, deps, test). It must pass with zero warnings.
- `npm run build` bundles to `dist/`; `npm start` builds and launches Electron.
- CI runs `npm run check` on Ubuntu and macOS, so tests must not assume Linux (symlinked `/tmp`, extra env vars, case-insensitive paths). Compare realpaths, and never skip a test to get green.
- Release: calendar versions `YYYY.M.N` (ADR 0049). From a clean, up-to-date `main` run `npm run release` (bumps `package.json`/lockfile, commits `chore(release): <version>`, creates tag `v<version>`), then `git push --follow-tags origin main`; the `v*` tag builds, publishes the GitHub Release and bumps `Casks/beuve.rb` (docs/packaging.md). Don't use `npm version`, and don't edit the cask's `version` or `sha256` by hand.
- `npm run dist:mac` packages an arm64 dmg+zip into `out/` (ad-hoc signed unless `CSC_*`/`APPLE_*` are set); `npm run dist:linux-dir` builds `out/linux-unpacked/` for smoke tests (ADR 0048, `docs/packaging.md`). A new file main loads by path at run time must be added to `electron-builder.yml`.
- Don't add dependencies without an ADR. Never add lodash-style grab-bags; write a helper in `src/pkg/`.
- Write a short ADR (`docs/adr/0000-template.md`, add it to the README table) for any decision that constrains later work.

## Layout and boundaries (ADR 0002)

- `src/main` composition root, `src/preload` sandboxed bridge, `src/ui` Lit renderer, `src/internal/<domain>` domains, `src/pkg` shared utilities.
- Domains import only themselves and `#pkg/*`; cross-domain work flows through `src/main`.
- `src/pkg` imports only Node built-ins and other `src/pkg` modules. Zero npm dependencies.
- `src/ui` and `src/preload` never import `src/main` or `src/internal`.
- Nothing imports an entrypoint (`src/*/index.ts`). No other `index.ts` files exist.
- dependency-cruiser enforces all of this (`npm run deps`); type-only imports count.

## Files and exports

- File names are kebab-case.
- Exactly one runtime export per file, named after the file: `create-logger.ts` exports `createLogger`, `lru-cache.ts` exports class `LruCache`. Types may be exported alongside it, and a file may export only types.
- No default exports, no re-exports, no barrels.
- Aliases (package.json `imports`): `#contract/*` → `src/contract/*`, `#internal/*` → `src/internal/*`, `#pkg/*` → `src/pkg/*`.
- Import by exact path including the `.ts` extension (ADR 0008): `#pkg/logger/create-logger.ts`, `#internal/git/read-diff.ts`, `#contract/ipc-contract.ts`. Use relative imports only within the same directory tree of one domain or layer.

## Code style

- Newspaper order: the exported function or class first, then helpers below it in the order they're called.
- Top-level functions use `function`. Helpers inside functions are arrow functions. Classes use methods. Never `const f = () => …` at top level.
- Explicit return types on every function, including arrows.
- `import type` for type-only imports.
- Thin data, pure functions; discriminated unions (`#pkg/result/`) and branded types (`#pkg/brand/brand.ts`) for illegal states. Expected failures are `Result`s, not exceptions.
- No enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- No comments that restate code. Brief doc comments on exported API.
- Persistence: domains own their migrations and take a `DatabaseSync` parameter; only `src/main` opens the database (ADR 0006), via `#pkg/sqlite/`.

## Tests

- Vitest, colocated: `foo-bar.ts` is tested by `foo-bar.test.ts` in the same directory.
- `node:sqlite` works in tests directly; use `openDatabase(':memory:')`.
- Helpers shared between test files live in a `testing/` directory (ADR 0013), e.g. `#internal/git/testing/create-test-repository.ts`; only tests may import them.
- Main-process integration tests run in plain Node against `openAppDatabase(':memory:')` and a temp repository (`src/main/create-main-services.test.ts`).
- Local lint rules live in `eslint-local-rules/` with RuleTester tests beside them.

## Gotchas

- Don't use top-level `await` in `src/main/index.ts` before the app is ready: Electron waits for the ESM entry to finish loading before emitting `ready`, so `await app.whenReady()` there deadlocks. Use `app.once('ready', …)` or an async function.
- The preload is bundled as CommonJS (`dist/preload/index.cjs`) and runs sandboxed: only `electron`'s renderer APIs are available.
- The renderer CSP in `src/ui/index.html` is strict (`default-src 'none'`). Widen it deliberately, with an ADR.
