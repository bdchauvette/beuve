import { noSameTypePositionalParams } from './no-same-type-positional-params.ts';
import { createTypedRuleTester } from './testing/create-typed-rule-tester.ts';

createTypedRuleTester().run('no-same-type-positional-params', noSameTypePositionalParams, {
  valid: [
    'function f(): void {}',
    'function f(a: string): void {}',
    'function f(name: string, count: number): void {}',
    'function f(name: string, ...rest: string[]): void {}',
    'function f(a: string, b = ""): void {}',
    'function f({ a }: { a: number }, { b }: { b: number }): void {}',
    'abstract class A { abstract m(from: string, to: string): void; }',
    'function f(this: string, name: string): void {}',
    'function f(a: string, b: string): void {}',
    'function f(b: string, a: string): void {}',
    'function f(A: string, B: string): void {}',
    'function f(_a: string, _b: string): void {}',
    'function f(first: number, last: number): void {}',
    'function f(left: string, right: string): void {}',
    'function f(lhs: string, rhs: string): void {}',
    'function f(x: number, y: number): void {}',
    'function f(before: string, after: string): void {}',
    'function f(previous: string, next: string): void {}',
    'function f(_old: string, _new: string): void {}',
    'function f(start: number, end: number): void {}',
    'function f(min: number, max: number): void {}',
    'function f(actual: string, expected: string): void {}',
    'function f(expected: string, actual: string): void {}',
    'const f = (left: string, right: string): void => {};',
    'type F = (left: string, right: string) => void;',
    'interface I { m(start: Date, end: Date): void }',
    {
      code: 'function f(from: string, to: number): void {}',
    },
    {
      code: 'function f(source: string, target: string): void {}',
      options: [{ allowedPairs: [['source', 'target']] }],
    },
    'declare const xs: string[]; xs.sort((one, two) => one.localeCompare(two));',
    'declare const xs: string[]; xs.reduce((acc: string, item: string): string => acc + item, "");',
    'declare const t: EventTarget; t.addEventListener("x", function (e: Event, f: Event): void {});',
    'declare const xs: string[]; xs.map((p: string, q: string): string => p + q);',
    'new Promise((resolve: (v: string) => void, reject: (v: string) => void) => { resolve(""); reject(""); });',
    'interface I { m(left: string, right: string): void }\nclass A implements I { m(source: string, target: string): void {} }',
    'interface I { m(left: string, right: string): void }\ninterface J { n(): void }\nclass A implements J, I { m(source: string, target: string): void {} n(): void {} }',
    'class B { m(left: string, right: string): void {} }\nclass A extends B { override m(source: string, target: string): void {} }',
    'abstract class B { abstract m(source: string, target: string): void; }\nclass A extends B { override m(source: string, target: string): void {} }',
    'function f(source: string, target: string): void;\nfunction f(source: string, target: string, extra: number): void;\nfunction f(source: string, target: string, extra?: number): void {}',
    'class A { m(source: string, target: string): void; m(source: string, target: string, n?: number): void {} }',
    'interface I { m(source: string, target: string): void; m(source: string): void }',
    'declare function f(source: string, target: string): void;\ndeclare function f(source: number): void;',
    {
      code: 'interface I { m(input: string, type: string, sink: string): string }',
      filename: 'ambient.d.ts',
      name: 'a declaration file describes an API someone else defined',
    },
  ],
  invalid: [
    {
      code: 'function f(from: string, to: string): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'function f(source: string, target: string): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'function f(a: string, b: string, c: string): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'function f(name: string, left: number, right: number, other: number): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'function f(a: string, count: number, b: string): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'function f(x: number, y: number, z: number): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'type Id = string;\nfunction f(owner: Id, repo: string): void {}',
      errors: [{ messageId: 'sameTypeParams' }],
      name: 'aliases resolve to the same type',
    },
    {
      code: 'const f = (from: string, to: string): void => {};',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'const f = function (from: string, to: string): void {};',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'declare function f(from: string, to: string): void;',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'class A { m(from: string, to: string): void {} }',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'class A { constructor(from: string, to: string) {} }',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'interface I { implements: string }\nclass A implements I { implements = ""; constructor(from: string, to: string) {} }',
      errors: [{ messageId: 'sameTypeParams' }],
      name: 'a constructor is not dictated by implements',
    },
    {
      code: 'interface I { m(): void }\nclass A implements I { m(): void {} n(source: string, target: string): void {} }',
      errors: [{ messageId: 'sameTypeParams' }],
      name: 'implements exempts only the methods the interface declares',
    },
    {
      code: 'class A { m(first: string, second: string, third: number): void {} }',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'class B {}\nclass A extends B { m(source: string, target: string): void {} }',
      errors: [{ messageId: 'sameTypeParams' }],
      name: 'extends without override is not exempt',
    },
    {
      code: 'const h = { m(from: string, to: string): void {} };',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'interface I { m(from: string, to: string): void }',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'interface I { (from: string, to: string): void }',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'type F = (from: string, to: string) => void;',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'declare const xs: string[]; const cb = (from: string, to: string): void => {}; xs.forEach(() => cb("", ""));',
      errors: [{ messageId: 'sameTypeParams' }],
      name: 'a named callback is not passed directly',
    },
    {
      code: 'declare function run(cb: () => void): void; run(() => { const g = (from: string, to: string): void => {}; g("", ""); });',
      errors: [{ messageId: 'sameTypeParams' }],
    },
    {
      code: 'function f(a: string, b: string): void {}',
      options: [{ allowedPairs: [['x', 'y']] }],
      errors: [{ messageId: 'sameTypeParams' }],
      name: 'custom list replaces the default',
    },
  ],
});
