# 0060. Node 26 for tooling, tests and CI

- Status: Accepted
- Date: 2026-10-30

## Context

ADR 0059 moves all date and time handling to `Temporal`, read directly from the global. Shipped code runs inside Electron 45, but tests, scripts and lint run on a standalone Node. Measured on 2026-10-30:

| Runtime                             | V8   | `Temporal`                            | `Date.prototype.toTemporalInstant` |
| ----------------------------------- | ---- | ------------------------------------- | ---------------------------------- |
| Electron 45.1 main (Node 24.22.1)   | 15.6 | yes                                   | yes                                |
| Electron 45.1 renderer (Chrome 156) | 15.6 | yes                                   | yes                                |
| Node 24.22.2                        | 13.6 | no (only behind `--harmony-temporal`) | no                                 |
| Node 26.0.0 and 26.13.0 (LTS)       | 14.6 | yes                                   | yes                                |

Electron's main process embeds Chromium's V8, not Node 24's, which is why it has `Temporal` while standalone Node 24 does not. Node 26 became LTS on 2026-10-28. TypeScript 6.0 ships `lib.esnext.temporal` and `lib.esnext.date` (which declares `toTemporalInstant`).

## Decision

- Contributors, tests, scripts and CI use Node 26: `.node-version` holds `26`, `engines.node` is `>=26.0.0`, and both workflows read `.node-version` through `actions/setup-node`'s `node-version-file`.
- No Temporal polyfill. Both tsconfigs add `esnext.temporal` and `esnext.date` to `lib`; the target stays ES2024.
- Shipped code still runs on Electron's Node 24, so `eslint-plugin-n` checks `src/` (except tests and `testing/` helpers) against `>=24.22.0`, and `@types/node` stays on 24. esbuild still targets `node24` and `chrome140`; it does not transform `Temporal`.
- Node 26's `node:sqlite` no longer prints an ExperimentalWarning, so the Vitest `execArgv` that silenced it is gone.

## Consequences

Tests exercise the same native `Temporal` the app uses. Contributors on Node 22 or 24 must upgrade. Node 26 APIs (such as the experimental `node:vfs`, see ADR 0058) are available to tests and scripts but must not appear in shipped code; the n-plugin setting catches built-in modules and their members, not language features, so the Electron version remains the real limit. When Electron moves to a newer Node, raise the n-plugin version with it.
