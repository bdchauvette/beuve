import os from 'node:os';

import { configDefaults, defineConfig } from 'vitest/config';

import { convertedTestDirs } from './converted-test-dirs.ts';

const allTests = ['src/**/*.test.ts', 'eslint-local-rules/**/*.test.ts', 'scripts/**/*.test.ts'];
const convertedTests = convertedTestDirs.map((directory) => `${directory}/*.test.ts`);

const maxConcurrency = Math.max(1, Math.floor(os.availableParallelism() / 2));

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        // ADR 0058: tests run concurrently unless they opt out with `{ concurrent: false }`, and
        // files share workers: converted tests keep no module state and mock no modules.
        test: {
          name: 'concurrent',
          include: convertedTests,
          sequence: { concurrent: true },
          isolate: false,
          // Tests are mostly CPU-bound (git processes), so running more of a file's tests at once
          // than there are CPUs only makes each one's timeout cover the others' work (ADR 0058).
          maxConcurrency,
        },
      },
      {
        extends: true,
        // Not yet converted; removed once `convertedTestDirs` covers everything.
        test: {
          name: 'legacy',
          include: allTests,
          exclude: [...configDefaults.exclude, ...convertedTests],
        },
      },
    ],
  },
});
