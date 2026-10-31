# beuve contributor guide

Electron + Node + TypeScript + Lit code-review workbench. Read `docs/architecture-spec.md`, then `docs/adr/` (ADRs override the spec).

## Before committing

- Run `npm run check` (typecheck, lint, format:check, deps, test). It must pass with zero warnings.
- `npm run build` bundles to `dist/`; `npm start` builds and launches Electron.
- CI runs `npm run check` on Ubuntu and macOS, so tests must not assume Linux (symlinked `/tmp`, extra env vars, case-insensitive paths). Compare realpaths, and never skip a test to get green.
- Release: calendar versions `YYYY.M.N` (ADR 0049). From a clean, up-to-date `main` run `npm run release` (bumps `package.json`/lockfile, commits `chore(release): <version>`, creates tag `v<version>`), then `git push --follow-tags origin main`; the `v*` tag builds, publishes the GitHub Release and bumps `Casks/beuve.rb` (docs/packaging.md). Don't use `npm version`, and don't edit the cask's `version` or `sha256` by hand.
- `npm run dist:mac` packages an arm64 dmg+zip into `out/` (ad-hoc signed unless `CSC_*`/`APPLE_*` are set); `npm run dist:linux-dir` builds `out/linux-unpacked/` for smoke tests (ADR 0048, `docs/packaging.md`). A new file main loads or runs by path at run time (a script, wasm, a binary, a resource) must be added to `electron-builder.yml` (`files`, `asarUnpack` or `extraResources`), and checked in `npm run dist:linux-dir`.
- Don't add dependencies without an ADR. Never add lodash-style grab-bags; write a helper in `src/x/<group>/` (groups are general domains: `collections`, `log`, `result`, `text`, `time`, ...) if it could plausibly belong in a JavaScript standard library, else in the shared directory it belongs to.
- Write a short ADR (`docs/adr/0000-template.md`, add it to the README table) for any decision that constrains later work.

## Layout and boundaries (ADR 0002)

- `src/main` composition root, `src/preload` sandboxed bridge, `src/ui` Lit renderer, `src/internal/<domain>` domains, `src/x` extended standard library, and the shared leaf directories `src/git` (git primitives, not the `internal/git` domain), `src/jsonrpc`, `src/release` and `src/sqlite`.
- Domains import only themselves and the shared directories (`#x/*`, `#git/*`, `#jsonrpc/*`, `#release/*`, `#sqlite/*`); cross-domain work flows through `src/main`.
- `src/x` holds only what could plausibly join the JavaScript standard library (ADR 0002 amendment) and imports only Node built-ins and other `src/x` modules. Each of `src/git`, `src/jsonrpc`, `src/release`, `src/sqlite` imports only Node built-ins, `src/x` and itself. Zero npm dependencies in all of them. Script-only helpers live in `scripts/lib/`.
- `src/ui` and `src/preload` never import `src/main` or `src/internal`.
- Nothing imports an entrypoint (`src/*/index.ts`). No other `index.ts` files exist.
- Git runs only through the typed operations in `src/internal/git`, and each git command declares an interruption policy: `read`, `owned-write` or `atomic` (ADR 0079).
- beuve never pushes; `review/` branches are local only (ADR 0088). The runners refuse any subcommand not on `isAllowedGitCommand`'s list, which has no `push`, and `local/no-git-push` bans the strings. beuve writes only the review-edits worktree, never the user's checkout or index, and never commits for the user.
- beuve's per-commit checkouts are read-only (ADR 0033 amendment): seal after add and reopen directories before removal on the path's serial chain, and remove trees with `removeTree` (`#x/fs/remove-tree.ts`), never a bare `rm -r`.
- Single-object reads and ref lookups go through `GitRunner.objects`, the per-root long-lived `GitObjectReader` on `cat-file --batch-command` (ADR 0087), inside a typed operation (`resolveRevision`, `readBlobs`, `findTreeBlob`, `readBlobBytes`); never add a one-off `cat-file`. Diffs, `ls-tree -r`, `git grep` and writes still spawn.
- dependency-cruiser enforces all of this (`npm run deps`); type-only imports count.

## Files and exports

- File names are kebab-case.
- Exactly one runtime export per file, named after the file: `create-logger.ts` exports `createLogger`, `lru-cache.ts` exports class `LruCache`. Types may be exported alongside it, and a file may export only types.
- No default exports, no re-exports, no barrels.
- Aliases (package.json `imports`): `#contract/*` → `src/contract/*`, `#internal/*` → `src/internal/*`, `#x/*` → `src/x/*`, `#git/*`, `#jsonrpc/*`, `#release/*`, `#sqlite/*` → the matching `src/<dir>/*`.
- Import by exact path including the `.ts` extension (ADR 0008): `#x/log/create-logger.ts`, `#internal/git/read-diff.ts`, `#contract/ipc-contract.ts`. Use relative imports only within the same directory tree of one domain or layer.

## Code style

- Newspaper order: the exported function or class first, then helpers below it in the order they're called.
- Top-level functions use `function`. Helpers inside functions are arrow functions. Classes use methods. Never `const f = () => …` at top level.
- Explicit return types on every function, including arrows.
- Control flow and signatures (ADR 0086, all linted):
  - No ternaries except directly in a Lit `html`/`svg` template slot, and never nested: use `if`/`else`, early returns, a helper or a lookup. Braces on every `if`, `else` and loop.
  - An arrow keeps an expression body only when it is one trivial line; otherwise use braces (`--fix` adds them, then run Prettier).
  - Name every object type in a parameter or return type. The filter argument of `Extract`/`Exclude` is exempt.
  - At most 3 parameters, and no two positional parameters of the same type: use an options object or a branded type. Same-type pairs are allowed only as exactly two parameters named a/b, first/last, left/right, lhs/rhs, x/y, before/after, previous/next, old/new, start/end, min/max, actual/expected or key/value (not from/to or then/now). A signature dictated by a callee or an explicit type (a callback passed to a call, `const f: T = …`, `satisfies`) is exempt.
- Conversion naming (ADR 0062): an instance method that converts types is `x.toY()`; a static method or standalone function is `yFrom(x)` (or `yFromX(x)` / `Y.fromX(x)` when not polymorphic). `x.to…` lists every outgoing conversion and `Y.from…` / `yFrom…` every incoming one in autocomplete, and `x.toY()` reads as the object acting while `Y.fromX(x)` instructs the destination to build itself. Lint bans `to[A-Z]…` standalone/static functions and `from[A-Z]…` instance methods; write infix names the same way (`checkpointFromRow`, not `rowToCheckpoint`; motion such as `scrollToHunk` is not a conversion). `parse…` stays for validating untrusted input. Prior art: [Rust API guidelines C-CONV](https://rust-lang.github.io/api-guidelines/naming.html#ad-hoc-conversions-follow-as_-to_-into_-conventions-c-conv), [.NET Framework Design Guidelines](https://learn.microsoft.com/dotnet/standard/design-guidelines/).
- `import type` for type-only imports.
- Forward an `AbortSignal` in scope (a parameter, options `signal`, the test context's `signal`, a local or field controller) to every callee that takes one (ADR 0075, `local/forward-abort-signal`); disable the line with a reason only for work that must outlive the caller.
- Thin data, pure functions; discriminated unions (`#x/result/`) and branded types (`#x/brand/brand.ts`) for illegal states. Expected failures are `Result`s, not exceptions.
- Normalise a caught `unknown` with `errorFrom(e)` (`#x/error/error-from.ts`) and show a `Temporal.Duration` with `formatDuration(d)` (`#x/time/format-duration.ts`, `Intl.DurationFormat`); lint bans the hand-written versions (ADR 0080).
- Resources (temp dirs, file handles, timers, listeners, processes) are released by `using`/`await using`, with a per-call `DisposableStack` for what isn't a disposable value; deadlines are `AbortSignal.any([signal, timeoutSignal(d)])`, told from cancels by `reason`; `finally` is for bookkeeping only (ADR 0076, `local/prefer-using`).
- Modern APIs (ADR 0080, `lib` is `es2025` plus `esnext.*`): `Error.isError`, `getOrInsertComputed`, `URL.parse`, `tailOf` (never `string.slice(-n)`), `RegExp.escape`, `Uint8Array` base64/hex; stream-decode child output with `setEncoding('utf8')`. Anything a test runs must exist on Node 26 (no `Iterator.zip`, `Math.sumPrecise`).
- No enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- No comments that restate code. Brief doc comments on exported API.
- Persistence: domains own their migrations and take a `DatabaseSync` parameter; only `src/main` opens the database (ADR 0006), via `#sqlite/`.
- Files (ADR 0082): replace a file only through `writeFileAtomic` (`#x/fs/write-file-atomic.ts`), with an explicit mode. Anything in `userData` is created 0600 (directories 0700), and a new file there that older installs may hold goes on `secureUserData`'s list. Open a path once and ask the handle (`handle.stat()`), never `stat`/`access`/`existsSync` and then open by path (`local/no-check-then-open`).

## Tests

Conventions and examples: `docs/testing.md` (ADR 0058; time: ADR 0059). Every test follows them and lint enforces it.

- Vitest, colocated: `foo-bar.ts` is tested by `foo-bar.test.ts` in the same directory. Dev, tests and CI run on Node 26 (`.node-version`, ADR 0060); shipped code runs on Electron's Node 24.
- Import `test` from the nearest `testing/test.ts` (`#testing/test.ts` for domain-free fixtures: `tempDir`, `db`, `logger`, `clock`; `#internal/git/testing/test.ts` adds `repo`, `repository`, `repositories` with worker-built templates). Take `expect` and every fixture from the context: `test('…', async ({ expect, repo }) => …)`.
- No hooks, no module-root `const`/`let` in test files (top-level `function` helpers are fine), no `if` in tests (`okValueFrom` from `#testing/ok-value-from.ts`), no module mocking (`vi.mock`, `vi.hoisted`, `vi.spyOn` on imports): inject dependencies.
- Tests run concurrently. A test that fakes time (`clock` fixture, `vi.useFakeTimers`) or touches `process.env` is declared `test('…', { concurrent: false }, …)`.
- Never inject clocks: code reads `Temporal.Now`; tests use the `clock` fixture. No `Date` and no arithmetic on time numbers anywhere (`local/no-date`, `local/no-time-number-arithmetic`).
- `node:sqlite` works in tests directly; the `db` fixture is `openDatabase(':memory:')`.
- Helpers shared between test files live in a `testing/` directory (ADR 0013, 0058); only tests may import them. Domain-free fixtures live in `src/testing/`.
- Main-process integration tests run in plain Node against `openAppDatabase(':memory:')` and a temp repository (`src/main/create-main-services.test.ts`).
- Local lint rules live in `eslint-local-rules/` with RuleTester tests beside them (`testing/create-typed-rule-tester.ts` for type-aware rules).

## Gotchas

- Don't use top-level `await` in `src/main/index.ts` before the app is ready: Electron waits for the ESM entry to finish loading before emitting `ready`, so `await app.whenReady()` there deadlocks. Use `app.once('ready', …)` or an async function.
- The preload is bundled as CommonJS (`dist/preload/index.cjs`) and runs sandboxed: only `electron`'s renderer APIs are available.
- Node children (language servers, trace probes, anything that must _be_ Node) run the Node from `resolveNodeRuntime` (`src/main/node-runtime/`) with a plain `spawn`: the bundled `resources/node/node` when packaged, `node` on `PATH` otherwise (ADR 0083). The `runAsNode` fuse is off, so never use `process.execPath` with `ELECTRON_RUN_AS_NODE`, nor `child_process.fork`, in `src/main` or `src/internal` (`local/no-electron-as-node`). The bundled version is pinned with checksums in `scripts/node-runtime.json` and bumped deliberately (ADR 0084).
- Show a repository path in the UI through `pathText(path)` (`src/ui/path-text.ts`, with `formatControlStyles` in the element's styles), or `revealFormatControls` for plain text, so bidi and invisible characters show as `⟨U+202E⟩` (ADR 0082). Keep the raw path in the `title`. `@pierre/trees` gets revealed paths and maps them back with `restoreFormatControls`.
- The renderer CSP in `src/ui/index.html` is strict (`default-src 'none'`). Widen it deliberately, with an ADR.
- The renderer enforces Trusted Types (ADR 0077): the `default` policy (`src/ui/install-trusted-types-policy.ts`) sanitizes the HTML strings `@pierre/diffs` and `@pierre/trees` assign, and our code never writes HTML strings (lint bans the sinks); to render one, use `element.setHTML(html, { sanitizer })`. Adding a name to the CSP's `trusted-types` list, or a script URL to the policy, needs an ADR.
- No HTML string sinks in `src/ui` (`innerHTML`, `insertAdjacentHTML`, `unsafeHTML`, …; lint, ADR 0077): build nodes. To render an HTML string, use `element.setHTML(html, { sanitizer })`.
- Commands (ADR 0068): every command is in `src/contract/command-catalog.ts` with its behaviour in `src/ui/command-registry.ts`, and every shortcut has a menu item. Chords are menu accelerators dispatched by main (`menu:run`); the renderer never handles a chord itself and binds no bare letters. Mark chords a text field uses `textConflict`. Show keys in tooltips from the catalog, never in UI text.
- Repeated templates delegate events (ADR 0074): mark items with `data-action`/`data-*` and handle them with an `ActionDelegation` on the component; `local/no-listener-in-repeated-template` flags `@event=` bindings in `.map`/`repeat` callbacks.
- Every model call is a chat request (ADR 0055–0057): add an LLM feature as a chat command that goes through the per-session queue in `src/main/chat`, not as a new service, table or channel.
