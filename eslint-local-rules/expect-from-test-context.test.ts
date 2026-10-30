import { createRuleTester } from './create-rule-tester.ts';
import { expectFromTestContext } from './expect-from-test-context.ts';

createRuleTester().run('expect-from-test-context', expectFromTestContext, {
  valid: [
    "import { test } from 'vitest'; test('a', ({ expect }) => { expect(1).toBe(1); });",
    "import { test } from 'vitest'; test('a', (context) => { context.expect(1).toBe(1); });",
    "import type { ExpectStatic } from 'vitest'; function check(expect: ExpectStatic): void { expect(1).toBe(1); }",
    "import { test } from 'vitest'; test('a', ({ expect }) => { const helper = (): void => { expect.assertions(1); }; helper(); });",
    "import { expectTypeOf, test } from 'vitest'; test('a', () => { expectTypeOf(1).toBeNumber(); });",
    'const options = { expect: 1 }; const n = options.expect;',
  ],
  invalid: [
    {
      code: "import { expect, test } from 'vitest'; test('a', () => { expect(1).toBe(1); });",
      errors: [{ messageId: 'imported' }],
    },
    {
      code: "import { test } from 'vitest'; test('a', () => { expect(1).toBe(1); });",
      errors: [{ messageId: 'notFromContext' }],
    },
    {
      code: "import * as vitest from 'vitest'; vitest.test('a', () => { vitest.expect(1).toBe(1); });",
      errors: [{ messageId: 'notFromContext' }],
    },
    {
      code: "import { test } from 'vitest'; test('a', (context) => { const expect = context.expect; expect(1).toBe(1); });",
      errors: [{ messageId: 'notFromContext' }],
    },
  ],
});
