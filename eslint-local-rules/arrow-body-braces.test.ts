import { arrowBodyBraces } from './arrow-body-braces.ts';
import { createRuleTester } from './create-rule-tester.ts';

createRuleTester().run('arrow-body-braces', arrowBodyBraces, {
  valid: [
    'const f = (): number => { return 1; };',
    'const f = (x: number): number => x;',
    'const f = (): number => 1;',
    'const f = (): string => "a";',
    'const f = (x: { a: number }): number => x.a;',
    'const f = (x: { a: { b: number } }): number => x.a.b;',
    'const f = (x: number[]): number | undefined => x[0];',
    'const f = (x: { a?: number }): number | undefined => x?.a;',
    'const f = (x: number): number => g(x, 1);',
    'const f = (x: number): number => g(x).h(1);',
    'const f = (x: number): boolean => !x;',
    'const f = (x: number): number => -x;',
    'const f = (x: number, y: number): number => x + y * 2;',
    'const f = (x: number, y: number): boolean => x > 1 && y < 2;',
    'const f = (x: string): string => `a${x}`;',
    'const f = (x: { a: string }): string => `a${x.a}b`;',
    'const f = (x: string): string => x as string;',
    'const f = (x: string | undefined): string => x!;',
    'const f = async (): Promise<number> => await g();',
    'const f = (x: number): void => g(x);',
    'const f = (): void => void g();',
    'g((x) => x.a);',
    'g(1, (x) => x.a);',
    'const xs = [1].map((x) => x + 1);',
    'const f = (x: number): number => new Y(x);',
  ],
  invalid: [
    {
      code: 'const f = (): { a: number } => ({ a: 1 });',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (): { a: number } => {\n  return { a: 1 };\n};',
    },
    {
      code: 'const f = (x: number): (() => number) => () => x;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): (() => number) => {\n  return () => x;\n};',
    },
    {
      code: 'const f = (x: number): number => g(() => x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return g(() => x);\n};',
    },
    {
      code: 'const f = async (): Promise<number> => await g(await h());',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = async (): Promise<number> => {\n  return await g(await h());\n};',
    },
    {
      code: 'const f = async (): Promise<number> => (await g()).value;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = async (): Promise<number> => {\n  return (await g()).value;\n};',
    },
    {
      code: 'const f = (x: number): number => (y = x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return (y = x);\n};',
    },
    {
      code: 'const f = (x: number): number => (g(), x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return (g(), x);\n};',
    },
    {
      code: 'const f = (x: boolean): number => x ? 1 : 2;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: boolean): number => {\n  return x ? 1 : 2;\n};',
    },
    {
      code: 'const f = (x: number): number[] => [x];',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number[] => {\n  return [x];\n};',
    },
    {
      code: 'const f = (x: number): number => x++;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return x++;\n};',
    },
    {
      code: 'const f = (x: number): Tpl => tag`a${x}`;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): Tpl => {\n  return tag`a${x}`;\n};',
    },
    {
      code: 'const f = (x: string): string => `a${() => x}`;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: string): string => {\n  return `a${() => x}`;\n};',
    },
    {
      code: 'const f = (x: number): void => (y = x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): void => {\n  y = x;\n};',
    },
    {
      code: 'const f = (): void => ({ a: 1 }).a++;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (): void => {\n  ({ a: 1 }).a++;\n};',
    },
    {
      code: 'const f = async (): Promise<void> => await g(await h());',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = async (): Promise<void> => {\n  await g(await h());\n};',
    },
    {
      // Without an `await`, the body may be a promise the bare statement would drop.
      code: 'const f = async (): Promise<void> => g(await h());',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = async (): Promise<void> => {\n  return g(await h());\n};',
    },
    {
      code: 'const f = (): Promise<void> => g(() => 1);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (): Promise<void> => {\n  return g(() => 1);\n};',
    },
    {
      code: 'const f = (x: number) => void g(() => x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number) => {\n  void g(() => x);\n};',
    },
    {
      code: 'g(\n  (x) => x.a,\n  1,\n);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'g(\n  (x) => {\n    return x.a;\n  },\n  1,\n);',
    },
    {
      code: 'g(a, (x) => x.a,);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'g(a, (x) => {\n  return x.a;\n},);',
    },
    {
      code: 'const handlers = {\n  a: (x: number): number => x,\n};',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const handlers = {\n  a: (x: number): number => {\n    return x;\n  },\n};',
    },
    {
      code: 'const list = [\n  (x: number): number => x,\n  1,\n];',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const list = [\n  (x: number): number => {\n    return x;\n  },\n  1,\n];',
    },
    {
      code: 'const f = (x: number): number =>\n  x + 1;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return x + 1;\n};',
    },
    {
      code: 'function outer(): void {\n  const f = (x: number): number =>\n    g(\n      x,\n      1,\n    );\n}',
      errors: [{ messageId: 'useBlockBody' }],
      output:
        'function outer(): void {\n  const f = (x: number): number => {\n    return g(\n        x,\n        1,\n      );\n  };\n}',
    },
    {
      code: 'const f = (x: string): string =>\n  `a\n${x}`;',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: string): string => {\n  return `a\n${x}`;\n};',
    },
    {
      code: 'const f = (x: number): number => /* keep */ (y = x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  /* keep */\n  return (y = x);\n};',
    },
    {
      code: 'const f = (x: number): number =>\n  // keep\n  (y = x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  // keep\n  return (y = x);\n};',
    },
    {
      code: 'const f = (x: number): number => (y = /* inner */ x);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return (y = /* inner */ x);\n};',
    },
    {
      code: 'const f = (x: number): number => (y = x /* after */);',
      errors: [{ messageId: 'useBlockBody' }],
      output: 'const f = (x: number): number => {\n  return (y = x);\n  /* after */\n};',
    },
  ],
});
