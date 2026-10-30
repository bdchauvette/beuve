# 0002. Modular monolith layout and import rules

- Status: Accepted
- Date: 2026-10-28

## Context

The spec calls for a Go-inspired single-package layout (`src/internal/`, `src/pkg/`, `src/main/`, `src/preload/`, `src/ui/`) with import aliases and dependency-cruiser enforcement. Two details in the spec's sample config conflict with each other or with the tool:

- The `no-barrel-files` rule forbids importing any `index.ts`, yet the sample code imports `#pkg/logger/index.js`.
- The `domain-isolation` rule uses a regex backreference (`\1`), which dependency-cruiser does not support; it uses `$1` group substitution in `pathNot` instead.

## Decision

- Every module is imported by its exact file path, e.g. `#pkg/logger/create-logger.js`. There are no `index.ts` files except process entrypoints (`src/main/index.ts`, `src/preload/index.ts`, `src/ui/index.ts`), and nothing may import an entrypoint.
- Each file has exactly one runtime export, named after the file (`create-logger.ts` exports `createLogger`). Types may be exported alongside it.
- Aliases: `#internal/*` and `#pkg/*` via the package.json `imports` field. Relative imports are used only within the same domain directory.
- `src/internal/<domain>` may import from its own domain and `#pkg/*`, never from another domain. `src/main` is the composition root and may import any domain.
- `src/pkg` may import only Node built-ins and other `src/pkg` modules: no npm runtime dependencies and nothing from `internal`, `main`, `preload` or `ui`.
- `src/ui` and `src/preload` may not import `src/main` or `src/internal`; they talk to main only through the IPC contract.
- Domain isolation is expressed in dependency-cruiser as `from: { path: '^src/internal/([^/]+)/' }`, `to: { path: '^src/internal/', pathNot: '^src/internal/$1/' }`.

## Consequences

Import lines are longer but unambiguous, and grep/rename are trivial. Cross-domain coordination must flow through `src/main`, which keeps domains independently testable and lets us split them into workspace packages later without untangling imports.

## Amendment 2026-10-30: `src/pkg` becomes `src/x`, grouped by general domain

- `src/pkg` is renamed `src/x` and the alias `#pkg/*` becomes `#x/*`. The name follows Go's `golang.org/x`: shared utilities that live outside any application domain, so `pkg` no longer suggests a packaging unit. The rules are unchanged: only Node built-ins and other `src/x` modules, no npm dependencies, one runtime export per file named after the file, colocated tests.
- Utilities are grouped by general domain with short lowercase directory names (`brand`, `collections`, `git`, `image`, `jsonrpc`, `log`, `net`, `release`, `result`, `sqlite`, `text`, `time`, ...), never by application domain. Import by exact path, e.g. `#x/log/create-logger.ts`. `datastructures` became `collections` and `logger` became `log`.
- Helpers that domains had copied to stay isolated (`sqliteErrorCode`, `isUuid`, `isIsoTimestamp`, `isCommitSha`, `normalizeHostname`) now live once in `src/x/`. Test helpers that need npm packages (the tree-sitter loaders) cannot move there and stay in each domain's `testing/` directory.
- Older ADRs and the spec keep their historical `pkg` wording; read it as `x`.
