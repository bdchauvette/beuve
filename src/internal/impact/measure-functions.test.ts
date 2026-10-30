import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ecmascriptRules } from './ecmascript-rules.ts';
import type { FunctionMetrics } from './function-measurement.ts';
import type { ImpactNode } from './impact-node.ts';
import type { LanguageRules } from './language-rules.ts';
import { measureFunctions } from './measure-functions.ts';
import { parseTestSource } from './testing/parse-test-source.ts';
import type { TestLanguage } from './testing/parse-test-source.ts';

describe('measureFunctions', () => {
  describe('cognitive complexity (SonarSource whitepaper examples)', () => {
    test('scores sumOfPrimes 7: nested loops, nested if, labelled continue', async ({ expect }) => {
      const metrics = await metricsOf(`
        function sumOfPrimes(max: number): number {
          let total = 0;
          OUT: for (let i = 1; i <= max; ++i) {
            for (let j = 2; j < i; ++j) {
              if (i % j === 0) {
                continue OUT;
              }
            }
            total += i;
          }
          return total;
        }`);
      expect(metrics.get('sumOfPrimes')).toStrictEqual({
        cognitive: 7,
        cyclomatic: 4,
        lines: 12,
        maxNesting: 3,
        parameters: 1,
      });
    });

    test('scores getWords 1: a switch is one break in flow however many cases', async ({
      expect,
    }) => {
      const metrics = await metricsOf(`
        function getWords(number: number): string {
          switch (number) {
            case 1:
              return 'one';
            case 2:
              return 'a couple';
            case 3:
              return 'a few';
            default:
              return 'lots';
          }
        }`);
      expect(metrics.get('getWords')).toMatchObject({ cognitive: 1, cyclomatic: 4, maxNesting: 1 });
    });

    test('adds else and else-if without nesting increments', async ({ expect }) => {
      const metrics = await metricsOf(`
        function f(a: boolean, b: boolean, c: boolean): void {
          if (a) {
            if (b) {
              g();
            } else if (c) {
              g();
            } else {
              g();
            }
          }
        }`);
      expect(metrics.get('f')).toMatchObject({ cognitive: 5, cyclomatic: 4, maxNesting: 2 });
    });

    test('counts runs of like boolean operators, through parentheses', async ({ expect }) => {
      const metrics = await metricsOf(`
        function a(x, y, z) { return x && y && z; }
        function b(x, y, z, w) { return x && y || z && w; }
        function c(x, y, z) { return x && (y && z); }
        function d(x, y, z) { if (x && !(y || z)) {} }
        function e(x, y, z) { return x ?? y ?? z; }`);
      expect(cognitive(metrics)).toStrictEqual({ a: 1, b: 3, c: 1, d: 3, e: 1 });
      expect(metrics.get('b')?.cyclomatic).toBe(4);
    });

    test('nests ternaries and catch, but not try or finally', async ({ expect }) => {
      const metrics = await metricsOf(`
        function f(a, b) {
          try {
            if (a) {}
          } catch (error) {
            if (b) {}
            return a ? (b ? 1 : 2) : 3;
          } finally {
            if (a) {}
          }
        }`);
      // try-if 1, catch 1, catch-if 2, ternary 2, nested ternary 3, finally-if 1
      expect(metrics.get('f')).toMatchObject({ cognitive: 10, cyclomatic: 7, maxNesting: 3 });
    });

    test('adds one for recursion, by name or through this', async ({ expect }) => {
      const metrics = await metricsOf(`
        function factorial(n: number): number {
          return n <= 1 ? 1 : n * factorial(n - 1);
        }
        class Tree {
          depth(node: Node): number {
            return node.child === undefined ? 0 : 1 + this.depth(node.child);
          }
          other(): number { return this.depth(root) + depth(); }
        }`);
      expect(cognitive(metrics)).toStrictEqual({ factorial: 2, 'Tree.depth': 2, 'Tree.other': 0 });
    });

    test('ignores unlabelled jumps and counts each loop kind', async ({ expect }) => {
      const metrics = await metricsOf(`
        function f(items) {
          for (const item of items) { if (item) break; }
          while (true) { continue; }
          do {} while (false);
        }`);
      expect(metrics.get('f')).toMatchObject({ cognitive: 5, cyclomatic: 5 });
    });
  });

  describe('functions and names', () => {
    test('qualifies methods, nested functions and named function values', async ({ expect }) => {
      const measured = measureFunctions(
        await parseTestSource(`
          namespace Shapes {
            export class Circle {
              area(): number { return 1; }
              get radius(): number { return 1; }
              set radius(value: number) {}
              static create = (r: number) => new Circle();
            }
          }
          const handler = function named() {};
          export default function () {}
          const outer = () => {
            function inner(a, b = 1, ...rest) {
              if (a) {}
            }
            return [1].map((x) => x);
          };
          exports.run = async () => {};
          const object = { key() {}, value: () => {} };`),
        ecmascriptRules,
      );
      expect(measured.functions.map(({ name }) => name)).toStrictEqual([
        'Shapes.Circle.area',
        'Shapes.Circle.get radius',
        'Shapes.Circle.set radius',
        'Shapes.Circle.create',
        'handler',
        'default',
        'outer',
        'outer.inner',
        'outer.[1].map(…)',
        'exports.run',
        'object.key',
        'object.value',
      ]);
      const parameters = measured.functions.map(({ metrics }) => metrics.parameters);
      expect(parameters).toStrictEqual([0, 0, 1, 1, 0, 0, 0, 3, 1, 0, 0, 0]);
    });

    test('keeps nested functions out of their parent and restarts their nesting', async ({
      expect,
    }) => {
      const metrics = await metricsOf(`
        function outer(list) {
          if (list) {
            list.forEach((item) => {
              if (item) {}
            });
          }
        }`);
      expect(cognitive(metrics)).toStrictEqual({ outer: 1, 'outer.list.forEach(…)': 1 });
    });

    test('labels test callbacks and numbers duplicates and overload implementations', async ({
      expect,
    }) => {
      const measured = measureFunctions(
        await parseTestSource(`
          describe('parser', () => {
            test('parses', ({ expect }) => {});
            test('parses', ({ expect }) => {});
          });
          function over(a: string): void;
          function over(a: number): void;
          function over(a: unknown): void {}
          class C { m(): void; m(a?: number): void {} }`),
        ecmascriptRules,
      );
      expect(measured.functions.map(({ name }) => name)).toStrictEqual([
        "describe('parser')",
        "describe('parser').test('parses')",
        "describe('parser').test('parses')#2",
        'over',
        'C.m',
      ]);
    });

    test('parses TSX and JavaScript with the same rules', async ({ expect }) => {
      const tsx = await metricsOf(
        'const View = ({ on }) => <div onClick={() => on && go()}>{on ? <b /> : null}</div>;',
        'tsx',
      );
      const javascript = await metricsOf(
        'class A { field = () => { if (a) {} }; m() { return a || b; } }',
        'javascript',
      );
      expect(cognitive(tsx)).toStrictEqual({ View: 1, 'View.<anonymous>': 1 });
      expect(cognitive(javascript)).toStrictEqual({ 'A.field': 1, 'A.m': 1 });
    });

    test('reports line spans, change digests and syntax errors', async ({ expect }) => {
      const first = measureFunctions(
        await parseTestSource('\nfunction f() {\n  return 1;\n}'),
        ecmascriptRules,
      );
      const reformatted = measureFunctions(
        await parseTestSource('function f() { return 1; }'),
        ecmascriptRules,
      );
      const renamed = measureFunctions(
        await parseTestSource('function g() { return 1; }'),
        ecmascriptRules,
      );
      const broken = measureFunctions(await parseTestSource('function f( {'), ecmascriptRules);

      expect(first.functions[0]).toMatchObject({ startLine: 2, endLine: 4, metrics: { lines: 3 } });
      expect(first.functions[0]?.textHash).toBe(reformatted.functions[0]?.textHash);
      expect(renamed.functions[0]?.textHash).not.toBe(first.functions[0]?.textHash);
      expect(renamed.functions[0]?.bodyHash).toBe(first.functions[0]?.bodyHash);
      expect(first.parseErrors).toBe(false);
      expect(broken.parseErrors).toBe(true);
    });

    test('walks very deep trees without overflowing the stack', async ({ expect }) => {
      const terms = Array.from({ length: 20_000 }, (_, index) => `x${String(index)}`);
      const metrics = await metricsOf(`function wide() { return ${terms.join(' && ')}; }`);
      expect(metrics.get('wide')).toMatchObject({ cognitive: 1, cyclomatic: 20_000 });
    });
  });

  test('measures any grammar its rules describe, from hand-built nodes', ({ expect }) => {
    const rules: LanguageRules = {
      functions: { def: { nameField: 'name', bodyField: 'body', parametersField: 'params' } },
      scopes: {},
      namers: {},
      constructs: { when: { kind: 'branch', decision: true, nestedFields: ['then'] } },
      transparent: [],
    };
    const node = nodeBuilder();
    const inner = node('when', 2, 2, [], 'then');
    const body = node('block', 1, 3, [node('when', 1, 3, [inner])], 'body');
    const tree = node('module', 0, 3, [
      node('def', 0, 3, [node('identifier', 0, 0, [], 'name', 'run'), body]),
    ]);
    expect(measureFunctions(tree, rules).functions).toMatchObject([
      { name: 'run', metrics: { cognitive: 3, cyclomatic: 3, maxNesting: 2, lines: 4 } },
    ]);
  });
});

async function metricsOf(
  source: string,
  language: TestLanguage = 'typescript',
): Promise<ReadonlyMap<string, FunctionMetrics>> {
  const { functions } = measureFunctions(await parseTestSource(source, language), ecmascriptRules);
  return new Map(functions.map(({ name, metrics }) => [name, metrics]));
}

function cognitive(metrics: ReadonlyMap<string, FunctionMetrics>): Record<string, number> {
  return Object.fromEntries(Array.from(metrics, ([name, { cognitive: value }]) => [name, value]));
}

type TestNode = ImpactNode & { readonly field?: string };

type NodeBuilder = (
  type: string,
  startRow: number,
  endRow: number,
  children: readonly TestNode[],
  field?: string,
  text?: string,
) => TestNode;

/** Builds hand-built nodes with ids unique within the builder; `field` is the field a node sits in. */
function nodeBuilder(): NodeBuilder {
  let nextId = 0;
  return (type, startRow, endRow, children, field, text = type): TestNode => {
    nextId += 1;
    return {
      id: nextId,
      type,
      isNamed: true,
      text,
      hasError: false,
      startPosition: { row: startRow, column: 0 },
      endPosition: { row: endRow, column: 0 },
      children,
      // eslint-disable-next-line unicorn/no-null -- the interface mirrors tree-sitter, which returns null
      childForFieldName: (name) => children.find((child) => child.field === name) ?? null,
      ...(field !== undefined && { field }),
    };
  };
}
