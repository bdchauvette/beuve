# 0007. Build, test and tooling layout

- Status: Accepted; test helper and integration test placement refined by [0013](0013-test-helpers-in-testing-directories.md); contributor Node version superseded by [0060](0060-node-26-for-tooling-and-tests.md)
- Date: 2026-10-28

## Context

The spec names the tools (TypeScript, ESLint, Prettier, dependency-cruiser) but not how code is compiled, bundled and tested, or where tooling code lives. Electron 45 ships Node 24 and Chromium 156; contributors run Node 22.18+ locally.

## Decision

- **Type checking**: `tsc` with `noEmit` only. Two projects: `tsconfig.json` (Node code, `@types/node`, no DOM) and `src/ui/tsconfig.json` (DOM libs, no Node types). typescript-eslint's `projectService` picks the nearest one. Target and lib are ES2024, the newest level Node 22 fully supports, so tests and tooling run on local Node too. `erasableSyntaxOnly` bans enums, namespaces and parameter properties so every file runs under Node's type stripping.
- **Versions**: TypeScript 6.0 (typescript-eslint 8 supports `<6.1`; TypeScript 7 is not yet supported). ESLint 10, which every plugin we use supports (eslint-plugin-unicorn 79 requires it). All versions pinned exactly.
- **Bundling**: esbuild, driven by `scripts/build.ts`, which Node runs directly. `dist/main/index.js` is ESM for Node 24, `dist/preload/index.cjs` is CommonJS because the preload is sandboxed (ADR 0005), and `dist/ui/` holds an ESM bundle, `index.css` and a copied `index.html`. `electron` is external; everything else is bundled. The main bundle gets a `createRequire` banner so bundled CommonJS dependencies can `require` built-ins.
- **Decorators**: Lit components use standard (TC39) decorators with `accessor` fields. No `experimentalDecorators`; esbuild lowers them.
- **Tests**: Vitest, Node environment, colocated as `name.test.ts` next to the source. Type-level tests use `expectTypeOf`. `node:sqlite` imports work in Vitest without configuration; the config only silences its ExperimentalWarning. Integration and E2E tests go in `test/` (spec section 3) when they arrive.
- **Local ESLint rules** live in `eslint-local-rules/` at the repo root, not in `src/`: they are tooling, not application code, and dependency-cruiser only polices `src/`. They are TypeScript, imported by `eslint.config.js` through Node's type stripping, and tested with `@typescript-eslint/rule-tester` (a typed wrapper over ESLint's RuleTester) under Vitest. They follow the same conventions as `src/`.
- **Exemptions**: entrypoints (`src/*/index.ts`, `scripts/**`) and tests may have zero exports; config files (`*.config.*`, `.dependency-cruiser.js`, `types/*.d.ts`) may default-export. `electron` is a devDependency by Electron convention and allow-listed where lint and dependency-cruiser forbid devDependencies in `src/`.
- **Disabled rules**, each commented in `eslint.config.js`: `unicorn/name-replacements` (ex-`prevent-abbreviations`), `unicorn/no-asterisk-prefix-in-documentation-comments`, `security/detect-object-injection`, `security/detect-non-literal-fs-filename`, `n/no-missing-import` (tsc covers it). `unicorn/single-line-block-comment-style` is set to `single-line`.

## Consequences

One fast bundler and no `tsc` emit means the type checker and the build can't disagree about output, but `npm run typecheck` must run separately (it does, in `npm run check`). Two tsconfigs keep DOM types out of Node code and Node types out of the renderer; a `#pkg/*` module that touches Node APIs will fail the UI typecheck if the renderer imports it, which is intended. Adding a domain under `src/internal/` needs no configuration changes.
