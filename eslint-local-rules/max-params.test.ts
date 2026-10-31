import { createRuleTester } from './create-rule-tester.ts';
import { maxParams } from './max-params.ts';

createRuleTester().run('max-params', maxParams, {
  valid: [
    'function f(a: number, b: number, c: number): void {}',
    'function f(this: void, a: number, b: number, c: number): void {}',
    // A replacer's parameters are the library's.
    "'x'.replaceAll(/(a)(b)(c)/gu, (whole: string, a: string, b: string, c: string): string => whole + a + b + c);",
    'declare function on(cb: (...args: [number, number, number, number]) => void): void; on(function (a, b, c, d) {});',
    'declare class C { constructor(cb: (...args: [number, number, number, number]) => void); } new C((a, b, c, d) => {});',
    // A type dictates the parameters.
    'type F = (...args: [number, number, number, number]) => void; const f: F = function (a, b, c, d) {};',
    'type F = (...args: [number, number, number, number]) => void; const f: F = (a, b, c, d) => {};',
    'type F = (...args: [number, number, number, number]) => void; class A { f: F = (a, b, c, d) => {}; }',
    'type F = (...args: [number, number, number, number]) => void; const f = ((a: number, b: number, c: number, d: number): void => {}) satisfies F;',
    'interface H { m: (...args: [number, number, number, number]) => void } const h: H = { m: (a, b, c, d) => {} };',
    'interface H { m(...args: [number, number, number, number]): void } const h = { m(a: number, b: number, c: number, d: number): void {} } satisfies H;',
    {
      code: 'function f(a: number, b: number, c: number, d: number): void {}',
      options: [{ max: 4 }],
    },
  ],
  invalid: [
    {
      code: 'function f(a: number, b: number, c: number, d: number): void {}',
      errors: [{ messageId: 'exceed' }],
    },
    {
      code: 'const f = (a: number, b: number, c: number, d: number): void => {};',
      errors: [{ messageId: 'exceed' }],
    },
    {
      // An untyped function expression dictates nothing.
      code: 'const f = function (a: number, b: number, c: number, d: number): void {};',
      errors: [{ messageId: 'exceed' }],
    },
    {
      // Passed along, not as an argument: still counted.
      code: 'const handlers = { f: (a: number, b: number, c: number, d: number): void => {} };',
      errors: [{ messageId: 'exceed' }],
    },
    {
      code: 'type F = (a: number, b: number, c: number, d: number) => void;',
      errors: [{ messageId: 'exceed' }],
    },
    {
      code: 'function f(this: void, a: number, b: number, c: number): void {}',
      options: [{ countVoidThis: true }],
      errors: [{ messageId: 'exceed' }],
    },
  ],
});
