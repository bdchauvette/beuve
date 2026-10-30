import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'eslint-local-rules/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
