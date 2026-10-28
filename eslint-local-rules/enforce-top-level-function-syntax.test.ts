import { createRuleTester } from './create-rule-tester.ts';
import { enforceTopLevelFunctionSyntax } from './enforce-top-level-function-syntax.ts';

createRuleTester().run('enforce-top-level-function-syntax', enforceTopLevelFunctionSyntax, {
  valid: [
    'function a(): void {}',
    'export function a(): void {}',
    'function a(): void { const b = (): void => {}; b(); }',
    'const value = 1;',
    'const handlers = { a: (): number => 1 };',
    'const handlers = { a(): number { return 1; } };',
    'const memo = wrap((): number => 1);',
    'class A { b(): void {} get c(): number { return 1; } }',
    'const o = { get a(): number { return 1; } };',
    'function* gen(): Generator<number> { function* inner(): Generator<number> { yield 1; } yield* inner(); }',
    'const items = [1].map((x) => x * 2);',
  ],
  invalid: [
    {
      code: 'const a = (): void => {};',
      errors: [{ messageId: 'useFunctionDeclaration', data: { name: 'a' } }],
    },
    {
      code: 'export const a = (): void => {};',
      errors: [{ messageId: 'useFunctionDeclaration', data: { name: 'a' } }],
    },
    {
      code: 'const a = function (): void {};',
      errors: [{ messageId: 'useFunctionDeclaration', data: { name: 'a' } }],
    },
    {
      code: 'let a = (() => 1) as () => number;',
      errors: [{ messageId: 'useFunctionDeclaration', data: { name: 'a' } }],
    },
    {
      code: 'function a(): void { function b(): void {} b(); }',
      errors: [{ messageId: 'useArrowForNested', data: { name: 'b' } }],
    },
    {
      code: 'export function a(): () => void { return function () {}; }',
      errors: [{ messageId: 'useArrowForExpression' }],
    },
    {
      code: '[1].map(function (x) { return x; });',
      errors: [{ messageId: 'useArrowForExpression' }],
    },
  ],
});
