import path from 'node:path';

import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

/**
 * A RuleTester for type-aware rules: test code is parsed as `file.ts` in a project with the
 * Temporal and `toTemporalInstant` libs (`typed-fixture/tsconfig.json`), wired to vitest. With
 * `'node-fixture'` the project also has Node's types (fetch, AbortSignal, `node:*` modules).
 */
export function createTypedRuleTester(
  fixture: 'typed-fixture' | 'node-fixture' = 'typed-fixture',
): RuleTester {
  RuleTester.afterAll = afterAll;
  RuleTester.describe = describe;
  RuleTester.it = it;
  RuleTester.itOnly = it.only;
  return new RuleTester({
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: path.join(import.meta.dirname, fixture),
      },
    },
  });
}
