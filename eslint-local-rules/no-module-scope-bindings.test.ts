import { createRuleTester } from './create-rule-tester.ts';
import { noModuleScopeBindings } from './no-module-scope-bindings.ts';

createRuleTester().run('no-module-scope-bindings', noModuleScopeBindings, {
  valid: [
    "import { test } from 'vitest';",
    'type Row = { readonly id: string };',
    'function make(): number { return 1; }',
    "test('a', () => { const local = 1; return local; });",
  ],
  invalid: [
    {
      code: 'const head = 1;',
      errors: [{ messageId: 'noModuleScopeBinding', data: { kind: 'const' } }],
    },
    {
      code: 'let count = 0;',
      errors: [{ messageId: 'noModuleScopeBinding', data: { kind: 'let' } }],
    },
    { code: 'export const shared = {};', errors: [{ messageId: 'noModuleScopeBinding' }] },
  ],
});
