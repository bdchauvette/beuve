import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { buildControlFlowGraph } from './build-control-flow-graph.ts';
import { ecmascriptFlowRules } from './ecmascript-flow-rules.ts';
import { findFunctionAt } from './find-function-at.ts';
import { buildTestGraph } from './testing/build-test-graph.ts';
import { describeGraph } from './testing/describe-graph.ts';
import { parseTestSource } from './testing/parse-test-source.ts';

describe('buildControlFlowGraph', () => {
  test('merges straight-line statements into one block', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f() {
  const a = 1;
  const b = 2;
  log(a + b);
}`);
    expect(describeGraph(graph)).toStrictEqual([
      'block:const a = 1 (+2) -next-> exit:end',
      'entry:f -next-> block:const a = 1 (+2)',
    ]);
    expect(graph.nodes.find((node) => node.kind === 'block')).toMatchObject({
      startLine: 2,
      endLine: 4,
    });
  });

  test('models an if / else-if / else chain with early returns', async ({ expect }) => {
    const graph = await buildTestGraph(`
function grade(score: number): string {
  if (score > 90) {
    return 'A';
  } else if (score > 80) {
    log('B');
    return 'B';
  } else {
    fail();
  }
  return 'C';
}`);
    expect(describeGraph(graph)).toStrictEqual(
      [
        "block:fail() -next-> return:return 'C'",
        'condition:score > 80 -false-> block:fail()',
        "condition:score > 80 -true-> block:log('B')",
        'condition:score > 90 -false-> condition:score > 80',
        "condition:score > 90 -true-> return:return 'A'",
        'entry:grade -next-> condition:score > 90',
        "block:log('B') -next-> return:return 'B'",
        "return:return 'A' -next-> exit:end",
        "return:return 'B' -next-> exit:end",
        "return:return 'C' -next-> exit:end",
      ].toSorted((left, right) => left.localeCompare(right)),
    );
  });

  test('joins both branches of an if without else', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f(x: boolean) {
  if (x) {
    a();
  }
  b();
}`);
    expect(describeGraph(graph)).toStrictEqual([
      'block:a() -next-> block:b()',
      'block:b() -next-> exit:end',
      'condition:x -false-> block:b()',
      'condition:x -true-> block:a()',
      'entry:f -next-> condition:x',
    ]);
  });

  test('does not count optional chaining, ternaries or short-circuits as branches', async ({
    expect,
  }) => {
    const graph = await buildTestGraph(`
function f(a?: { b?: number }) {
  const v = a?.b ?? (a ? 1 : 2);
  return v && v > 1 ? 'x' : 'y';
}`);
    expect(graph.nodes.map((node) => node.kind)).toStrictEqual([
      'entry',
      'exit',
      'block',
      'return',
    ]);
  });

  test('loops back, breaks and continues out of nested loops, including labels', async ({
    expect,
  }) => {
    const graph = await buildTestGraph(`
function f(items: number[]) {
  outer: for (const i of items) {
    for (let j = 0; j < i; j++) {
      if (j === 2) continue outer;
      if (j === 3) break;
      d();
    }
  }
  while (more()) {
    if (stop()) break;
    step();
  }
}`);
    expect(describeGraph(graph)).toStrictEqual(
      [
        'block:break -break-> loop:for (const i of items)',
        'block:continue outer -continue-> loop:for (const i of items)',
        'block:d() -loop-back-> loop:for (let j = 0; j < i; j++)',
        'block:break -break-> exit:end',
        'block:step() -loop-back-> loop:while (more())',
        'condition:j === 2 -false-> condition:j === 3',
        'condition:j === 2 -true-> block:continue outer',
        'condition:j === 3 -false-> block:d()',
        'condition:j === 3 -true-> block:break',
        'condition:stop() -false-> block:step()',
        'condition:stop() -true-> block:break',
        'entry:f -next-> loop:for (const i of items)',
        'loop:for (const i of items) -false-> loop:while (more())',
        'loop:for (const i of items) -true-> loop:for (let j = 0; j < i; j++)',
        'loop:for (let j = 0; j < i; j++) -false-> loop:for (const i of items)',
        'loop:for (let j = 0; j < i; j++) -true-> condition:j === 2',
        'loop:while (more()) -false-> exit:end',
        'loop:while (more()) -true-> condition:stop()',
      ].toSorted((left, right) => left.localeCompare(right)),
    );
  });

  test('closes a do-while with a loop-back from its condition', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f() {
  setup();
  do {
    step();
  } while (more());
}`);
    expect(describeGraph(graph)).toStrictEqual([
      'block:setup() -next-> block:step()',
      'block:step() -next-> loop:while (more())',
      'entry:f -next-> block:setup()',
      'loop:while (more()) -false-> exit:end',
      'loop:while (more()) -loop-back-> block:step()',
    ]);
  });

  test('falls through stacked and unterminated cases and exits on break', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f(x: number) {
  switch (x) {
    case 1:
    case 2:
      one();
    case 3:
      three();
      break;
    default:
      other();
  }
  done();
}`);
    expect(describeGraph(graph)).toStrictEqual(
      [
        'block:one() -next-> case:case 3',
        'block:other() -next-> block:done()',
        'block:three() (+1) -break-> block:done()',
        'block:done() -next-> exit:end',
        'case:case 1 -next-> case:case 2',
        'case:case 2 -next-> block:one()',
        'case:case 3 -next-> block:three() (+1)',
        'case:default -next-> block:other()',
        'entry:f -next-> switch:switch (x)',
        'switch:switch (x) -case-> case:case 1',
        'switch:switch (x) -case-> case:case 2',
        'switch:switch (x) -case-> case:case 3',
        'switch:switch (x) -default-> case:default',
      ].toSorted((left, right) => left.localeCompare(right)),
    );
  });

  test('lets a switch without default skip every case', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f(x: number) {
  switch (x) {
    case 1:
      return 1;
  }
  tail();
}`);
    expect(describeGraph(graph)).toContain('switch:switch (x) -default-> block:tail()');
  });

  test('routes returns and throws through finally and exceptions to catch', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f() {
  try {
    risky();
    return 5;
  } catch (e) {
    throw e;
  } finally {
    done();
  }
}`);
    expect(describeGraph(graph)).toStrictEqual([
      'block:done() -exception-> exit:end',
      'block:done() -next-> exit:end',
      'block:risky() -next-> return:return 5',
      'catch:catch (e) -next-> throw:throw e',
      'entry:f -next-> try:try',
      'finally:finally -next-> block:done()',
      'return:return 5 -finally-> finally:finally',
      'throw:throw e -finally-> finally:finally',
      'try:try -exception-> catch:catch (e)',
      'try:try -next-> block:risky()',
    ]);
  });

  test('continues after try/catch when the body can complete normally', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f() {
  try {
    risky();
  } catch {
    recover();
  }
  after();
}`);
    expect(describeGraph(graph)).toStrictEqual([
      'block:after() -next-> exit:end',
      'block:recover() -next-> block:after()',
      'block:risky() -next-> block:after()',
      'catch:catch -next-> block:recover()',
      'entry:f -next-> try:try',
      'try:try -exception-> catch:catch',
      'try:try -next-> block:risky()',
    ]);
  });

  test('sends a throw inside try to the catch and one outside to the exit', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f(x: number) {
  if (x < 0) throw new Error('neg');
  try {
    if (x === 0) throw new Error('zero');
  } catch (e) {
    log(e);
  }
}`);
    const edges = describeGraph(graph);
    expect(edges).toContain("throw:throw new Error('neg'); -exception-> exit:end".replace(';', ''));
    expect(edges).toContain("throw:throw new Error('zero') -exception-> catch:catch (e)");
  });

  test('keeps nested functions inside their block label', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f(items: number[]) {
  const handler = (x: number) => {
    if (x) { return 1; }
    return 2;
  };
  items.forEach(handler);
}`);
    expect(graph.nodes.map((node) => node.kind)).toStrictEqual(['entry', 'exit', 'block']);
    expect(graph.nodes[2]?.label).toBe('const handler = (x: number) => {… (+1)');
  });

  test('marks nodes whose own lines changed, not the lines of their branches', async ({
    expect,
  }) => {
    const graph = await buildTestGraph(
      `
function f(x: number) {
  if (x > 1) {
    a();
  } else {
    b();
  }
}`,
      { changedLines: [3] },
    );
    const changed = graph.nodes.filter((node) => node.changed).map((node) => node.label);
    expect(changed).toStrictEqual(['a()']);
  });

  test('flags a changed condition or loop header', async ({ expect }) => {
    const graph = await buildTestGraph(
      `
function f(x: number) {
  while (x > 1) {
    x--;
  }
}`,
      { changedLines: [2] },
    );
    expect(graph.nodes.filter((node) => node.changed).map((node) => node.kind)).toStrictEqual([
      'loop',
    ]);
  });

  test('names an arrow function after its variable and graphs an expression body', async ({
    expect,
  }) => {
    const graph = await buildTestGraph(`const pick = (x: number) => x > 1 ? 'a' : 'b';`);
    expect(graph.name).toBe('pick');
    expect(describeGraph(graph)).toStrictEqual([
      "entry:pick -next-> return:x > 1 ? 'a' : 'b'",
      "return:x > 1 ? 'a' : 'b' -next-> exit:end",
    ]);
  });

  test('reports too-large graphs instead of building them', async ({ expect }) => {
    const statements = Array.from({ length: 30 }, (_, index) => `if (c${String(index)}) { a(); }`);
    const root = await parseTestSource(`function f() { ${statements.join('\n')} }`);
    const found = findFunctionAt(root, 1, ecmascriptFlowRules);
    expect(found).toBeDefined();
    const result = buildControlFlowGraph(found ?? root, ecmascriptFlowRules, {
      changedLines: new Set(),
      maxNodes: 20,
    });
    expect(result).toStrictEqual({ ok: false, error: { kind: 'too-large', nodeLimit: 20 } });
  });

  test('rejects nodes that are not functions', async ({ expect }) => {
    const root = await parseTestSource('const x = 1;');
    const result = buildControlFlowGraph(root, ecmascriptFlowRules, { changedLines: new Set() });
    expect(result.ok).toBe(false);
  });

  test('drops unreachable code after a return', async ({ expect }) => {
    const graph = await buildTestGraph(`
function f() {
  return 1;
  dead();
}`);
    expect(graph.nodes.map((node) => node.kind)).toStrictEqual(['entry', 'exit', 'return']);
  });
});
