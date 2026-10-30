# 0013. Shared test helpers live in `testing/` directories

- Status: Accepted; amended by [0058](0058-test-fixtures-concurrency-and-test-lint-rules.md) (`src/testing/`, fixtures)
- Date: 2026-10-28

## Context

`createTestRepository` (a throwaway git repository driven with `execFileSync`) started in `src/internal/git/` next to production code, and the main-process integration test needs it too. ADR 0007 colocates tests but says nothing about helpers shared between test files, and a helper that sits beside production modules could be imported by one and bundled.

## Decision

- Test-only helpers go in a `testing/` directory inside the domain or layer they serve, e.g. `src/internal/git/testing/create-test-repository.ts`. They follow the usual file conventions. Tests elsewhere import them by alias (`#internal/git/testing/create-test-repository.ts`), which the import rules already allow from `src/main`.
- The dependency-cruiser rule `testing-only-in-tests` lets only `*.test.ts` files and other `testing/` modules import anything under a `testing/` directory. Bundles contain only what the entrypoints reach, so a helper can't end up in `dist/`.
- Integration tests that need no Electron stay colocated under `src/` (e.g. `src/main/create-main-services.test.ts`), so Vitest, tsc and lint cover them with no extra configuration. `test/` stays reserved for E2E tests that drive the built app.

## Consequences

Helpers are easy to find and safe to share. A helper needed by two domains has to live in one of them (or in `src/pkg/testing/` if it is domain-free), and the other domain can't import it: domain isolation applies to tests as well.
