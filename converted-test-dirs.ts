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
  'src/internal/auth',
  'src/internal/chat',
  'src/internal/flow',
  'src/internal/git',
  'src/internal/github',
  'src/internal/impact',
  'src/internal/llm',
  'src/internal/lsp',
  'src/internal/session',
  'src/internal/syntax',
  'src/internal/trace',
  'src/internal/ura',
  'src/jsonrpc',
  'src/main',
  'src/main/chat',
  'src/main/ipc',
  'src/main/ura',
  'src/release',
  'src/sqlite',
  'src/ui',
  'src/x/brand',
  'src/x/collections',
  'src/x/log',
  'src/x/net',
  'src/x/result',
  'src/x/text',
  'src/x/time',
];
