import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import { linkTestVitest } from '#internal/trace/testing/link-test-vitest.ts';

/**
 * Turns a test repository into a Vitest project the way a user's clone looks: `package.json`, a
 * Vitest config that includes `src/**\/*.test.ts`, and an ignored `node_modules` that links to
 * beuve's Vitest. Call before the first commit. Test-only (ADR 0013).
 */
export function createTraceTestProject(repo: TestRepository): void {
  repo.write('package.json', JSON.stringify({ name: 'fixture', type: 'module', private: true }));
  repo.write(
    'vitest.config.ts',
    "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { include: ['src/**/*.test.ts'] } });\n",
  );
  writeFileSync(path.join(repo.directory, '.gitignore'), 'node_modules\n');
  linkTestVitest(repo.directory);
}
