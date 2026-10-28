# 0008. Import specifiers use the `.ts` extension

- Status: Accepted
- Date: 2026-10-28

## Context

ADR 0002 requires importing by exact file path and shows `#pkg/logger/create-logger.js`. With TypeScript sources, a `.js` specifier names a file that doesn't exist until compilation, so each tool (tsc, Vitest, esbuild, dependency-cruiser, Node itself) has to be taught the `.js` to `.ts` mapping, and for `#` aliases several of them can't be. We never emit with `tsc` (ADR 0007), and Node 22.18+ and 24 run `.ts` files natively, but only when imported with their real extension.

## Decision

Every relative and alias import names the real file, extension included: `import { createLogger } from '#pkg/logger/create-logger.ts'`. `allowImportingTsExtensions` is on. The package.json `imports` field maps `#internal/*` to `./src/internal/*` and `#pkg/*` to `./src/pkg/*` verbatim. This refines ADR 0002's example; its rules are unchanged.

## Consequences

tsc, Vitest, esbuild, dependency-cruiser and Node resolve the same specifier with no extra configuration, and tooling (`scripts/`, `eslint-local-rules/`) runs without a loader. `tsc` can never emit JavaScript for this code as-is; if we ever need that, `rewriteRelativeImportExtensions` covers relative imports but not `#` aliases.
