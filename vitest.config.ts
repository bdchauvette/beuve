import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'eslint-local-rules/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // node:sqlite prints an ExperimentalWarning on import in Node 22 and 24 (ADR 0004).
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
