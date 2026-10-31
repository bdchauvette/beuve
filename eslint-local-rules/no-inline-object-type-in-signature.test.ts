import { createRuleTester } from './create-rule-tester.ts';
import { noInlineObjectTypeInSignature } from './no-inline-object-type-in-signature.ts';

createRuleTester().run('no-inline-object-type-in-signature', noInlineObjectTypeInSignature, {
  valid: [
    'function f(a: string): number { return 1; }',
    'interface Options { a: number }\nfunction f(options: Options): void {}',
    'type Result = { a: number };\nfunction f(): Result { return { a: 1 }; }',
    'const value: { a: number } = { a: 1 };',
    'type Shape = { handler: (a: number) => void };',
    'interface Shape { size: { w: number } }',
    'function f(a = { b: 1 }): void {}',
    'function f<T extends object>(a: T): T { return a; }',
    'const f = (a: Map<string, number>): Promise<string> => g(a);',
    'class A { constructor(readonly name: string) {} }',
    "function f(): Extract<Failure, { kind: 'gone' }> { throw new Error(); }",
    "function f(failure: Exclude<Failure, { kind: 'gone' | 'moved' }>): void {}",
  ],
  invalid: [
    {
      code: "function f(): Extract<{ kind: 'gone'; at: number }, { kind: 'gone' }> {}",
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(): Extract<Failure, { meta: { a: number } }> {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(options: { a: number }): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(): { a: number } { return { a: 1 }; }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'async function f(): Promise<{ a: number }> { return { a: 1 }; }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(): Result<{ a: number }, Error> { throw new Error(); }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f({ a, b }: { a: number; b: string }): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(...rest: { a: number }[]): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(a: { b: number } = { b: 1 }): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(list: Array<{ a: number }>): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(a: string | { b: number }): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(callback: (event: { a: number }) => void): void {}',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'function f(): (event: { a: number }) => { b: number } {}',
      errors: [{ messageId: 'nameTheType' }, { messageId: 'nameTheType' }],
    },
    {
      code: 'function f(a: { b: { c: number } }): void {}',
      errors: [{ messageId: 'nameTheType' }, { messageId: 'nameTheType' }],
    },
    {
      code: 'const f = function (a: { b: number }): void {};',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'const f = (a: { b: number }): void => {};',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'const f = (): { b: number } => ({ b: 1 });',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'declare function f(a: { b: number }): void;',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'class A { m(a: { b: number }): void {} }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'class A { m(): { b: number } { return { b: 1 }; } }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'class A { constructor(a: { b: number }) {} }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'class A { constructor(private readonly a: { b: number }) {} }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'abstract class A { abstract m(a: { b: number }): void; }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'interface I { m(a: { b: number }): void }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'interface I { (a: { b: number }): void }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'interface I { new (a: { b: number }): I }',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'type F = (a: { b: number }) => void;',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'type F = (a: number) => { b: number };',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'type C = new (a: { b: number }) => object;',
      errors: [{ messageId: 'nameTheType' }],
    },
    {
      code: 'interface I { on: (handler: (e: { b: number }) => void) => void }',
      errors: [{ messageId: 'nameTheType' }],
    },
  ],
});
