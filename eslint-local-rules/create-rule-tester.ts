import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

/** A typescript-eslint RuleTester wired to vitest's test hooks. */
export function createRuleTester(): RuleTester {
  RuleTester.afterAll = afterAll;
  RuleTester.describe = describe;
  RuleTester.it = it;
  RuleTester.itOnly = it.only;
  return new RuleTester();
}
