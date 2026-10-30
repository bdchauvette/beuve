/**
 * Test directories converted to the conventions of ADR 0058 (fixtures, no hooks, no module-root
 * bindings, `expect` from the context, concurrent by default). Each entry covers the `*.test.ts`
 * files directly inside it, not subdirectories. `eslint.config.js` applies the new test rules to
 * these files and `vitest.config.ts` runs them in the concurrent project; add a directory here in
 * the same commit that converts it.
 */
export const convertedTestDirs: readonly string[] = [
  'eslint-local-rules',
  'scripts/lib/image',
  'src/contract',
  'src/git',
  'src/internal/git',
  'src/internal/session',
  'src/ui',
];
