import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { test } from '#testing/test.ts';

import { applyEdits } from './apply-edits.ts';
import { ecmascriptTraceRules } from './ecmascript-trace-rules.ts';
import { planInstrumentation } from './plan-instrumentation.ts';
import { describeTimeline } from './testing/describe-timeline.ts';
import { parseTestSource } from './testing/parse-test-source.ts';
import { traceTestSource } from './testing/trace-test-source.ts';

function clamp(): string {
  return `function clamp(value, low, high) {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}`;
}

describe('planInstrumentation', () => {
  test('traces entry, branches and the return of the function enclosing the hunk', async ({
    expect,
  }) => {
    const trace = await traceTestSource(clamp(), { changedLines: [5], run: 'clamp(12, 0, 10)' });
    expect(trace.outcome).toStrictEqual({ value: 10 });
    expect(trace.plan.functions).toStrictEqual([
      { index: 0, name: 'clamp', startLine: 1, endLine: 9 },
    ]);
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '1: enter clamp(value=12, low=0, high=10)',
      '2: if value < low → false',
      '5: if value > high → true',
      '6: return 10',
    ]);
    expect(trace.timeline.entries.map((entry) => entry.inHunk)).toStrictEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  test('keeps every line where it was', async ({ expect }) => {
    const trace = await traceTestSource(clamp(), { changedLines: [2], run: 'clamp(1, 0, 10)' });
    const lines = trace.code.split('\n');
    expect(lines).toHaveLength(clamp().split('\n').length);
    expect(lines[1]).toContain('value < low');
    expect(lines[5]).toContain('return');
  });

  test('counts loop iterations per run and nests calls by depth', async ({ expect }) => {
    const source = `function total(values) {
  let sum = 0;
  for (const value of values) {
    sum += double(value);
  }
  return sum;
}
function double(n) {
  return n * 2;
}`;
    const trace = await traceTestSource(source, { changedLines: [4, 9], run: 'total([1, 2])' });
    expect(trace.outcome).toStrictEqual({ value: 6 });
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '1: enter total(values=[1, 2])',
      '3: loop for (const value of values) ×2',
      '  8: enter double(n=1)',
      '  9: return 2',
      '  8: enter double(n=2)',
      '  9: return 4',
      '6: return 6',
    ]);
  });

  test('records switch values, the cases entered and fallthrough', async ({ expect }) => {
    const source = `function kind(code) {
  switch (code) {
    case 1:
    case 2: return 'low';
    default:
      return 'other';
  }
}`;
    const trace = await traceTestSource(source, { changedLines: [4], run: 'kind(1)' });
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '1: enter kind(code=1)',
      '2: switch code = 1',
      '3: case 1',
      '4: case 2',
      '4: return "low"',
    ]);
  });

  test('reports thrown values, propagated exceptions and catches', async ({ expect }) => {
    const source = `function check(input) {
  if (!input) throw new Error('missing');
  return input;
}
function safe(input) {
  try {
    return check(input);
  } catch (error) {
    return 'fallback';
  }
}`;
    const trace = await traceTestSource(source, { changedLines: [2, 7], run: 'safe(0)' });
    expect(trace.outcome).toStrictEqual({ value: 'fallback' });
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '5: enter safe(input=0)',
      '  1: enter check(input=0)',
      '  2: if !input → true',
      '  2: throw Error: missing',
      '8: catch catch (error) = Error: missing',
      '9: return "fallback"',
    ]);

    const propagated = await traceTestSource(
      `function outer() {
  return inner();
}
function inner() { throw new TypeError('bad'); }`,
      { changedLines: [2], run: 'outer()' },
    );
    expect(propagated.outcome).toMatchObject({ error: { message: 'bad' } });
    expect(describeTimeline(propagated.timeline)).toStrictEqual([
      '1: enter outer()',
      '1: throw (propagated) TypeError: bad',
    ]);
  });

  test('instruments expression-bodied arrows, ternaries and implicit returns', async ({
    expect,
  }) => {
    const source = `const sign = (n) => n < 0 ? 'negative' : 'positive';
function log(message) {
  message.length;
}`;
    const trace = await traceTestSource(source, {
      changedLines: [1, 3],
      run: "[sign(-1), log('hi')]",
    });
    expect(trace.outcome).toMatchObject({ value: ['negative', undefined] });
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '1: enter sign(n=-1)',
      '1: ternary n < 0 → true',
      `1: return "negative"`,
      '2: enter log(message="hi")',
      '4: return (implicit) undefined',
    ]);
  });

  test('summarizes destructured parameters through arguments, and names methods by class', async ({
    expect,
  }) => {
    const source = `class Cart {
  add({ id }, count = 1, ...rest) {
    return id + count + rest.length;
  }
}`;
    const trace = await traceTestSource(source, {
      changedLines: [3],
      run: "new Cart().add({ id: 1 }, undefined, 'x')",
    });
    expect(trace.outcome).toStrictEqual({ value: 3 });
    expect(describeTimeline(trace.timeline)[0]).toBe(
      '2: enter Cart.add({ id }={ id: 1 }, count=1, rest=["x"])',
    );
  });

  test('wraps labelled loops whole, so labelled continue still works', async ({ expect }) => {
    const source = `function find(rows) {
  let hits = 0;
  outer: for (const row of rows) {
    for (const cell of row) {
      if (cell) { hits++; continue outer; }
    }
  }
  return hits;
}`;
    const trace = await traceTestSource(source, {
      changedLines: [5],
      run: 'find([[0, 1], [1], []])',
    });
    expect(trace.outcome).toStrictEqual({ value: 2 });
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '1: enter find(rows=[[0, 1], [1], []])',
      '3: loop for (const row of rows) ×3',
      '4: loop for (const cell of row) ×2',
      '5: if cell → false',
      '5: if cell → true',
      '4: loop for (const cell of row) ×1',
      '5: if cell → true',
      '4: loop for (const cell of row) ×0',
      '8: return 2',
    ]);
  });

  test('leaves nested functions alone unless they enclose a changed line', async ({ expect }) => {
    const source = `function outer(list) {
  return list.map((item) => {
    if (item) return 1;
    return 0;
  });
}`;
    const outer = await traceTestSource(source, { changedLines: [1], run: 'outer([1])' });
    expect(outer.plan.probes.map((probe) => probe.kind)).toStrictEqual(['enter', 'return']);
    const inner = await traceTestSource(source, { changedLines: [3], run: 'outer([1, 0])' });
    expect(inner.plan.functions.map((fn) => fn.name)).toStrictEqual(['<anonymous>']);
    expect(describeTimeline(inner.timeline)).toStrictEqual([
      '2: enter <anonymous>(item=1)',
      '3: if item → true',
      '3: return 1',
      '2: enter <anonymous>(item=0)',
      '3: if item → false',
      '4: return 0',
    ]);
  });

  test('keeps directives first and handles bare returns', async ({ expect }) => {
    const source = `function f(x) {
  'use strict';
  if (x) return;
  return x;
}`;
    const trace = await traceTestSource(source, { changedLines: [3], run: 'f(1)' });
    expect(trace.code).toMatch(/^function f\(x\) \{\n {2}'use strict';const __beuveFrame/u);
    expect(describeTimeline(trace.timeline)).toStrictEqual([
      '1: enter f(x=1)',
      '3: if x → true',
      '3: return undefined',
    ]);
  });

  test('refuses hunks outside functions and plans that are too large', async ({ expect }) => {
    const root = await parseTestSource('const a = 1;\nfunction f() {\n  return a;\n}');
    expect(
      planInstrumentation(root, { path: 'a.ts', changedLines: new Set([1]) }, ecmascriptTraceRules),
    ).toStrictEqual({ ok: false, error: { kind: 'no-function' } });
    expect(
      planInstrumentation(
        root,
        { path: 'a.ts', changedLines: new Set([3]), maxProbes: 1 },
        ecmascriptTraceRules,
      ),
    ).toStrictEqual({ ok: false, error: { kind: 'too-large', probeLimit: 1 } });
  });

  test('produces valid TypeScript for typed code without changing offsets of types', async ({
    expect,
  }) => {
    const source = `export function pick<T>(items: readonly T[], at: number): T | undefined {
  return at < items.length ? items[at] : undefined;
}`;
    const root = await parseTestSource(source);
    const plan = okValueFrom(
      planInstrumentation(
        root,
        { path: 'pick.ts', changedLines: new Set([2]) },
        ecmascriptTraceRules,
      ),
    );
    const code = applyEdits(source, plan.edits);
    const reparsed = await parseTestSource(code);
    expect(reparsed.text).toBe(code);
    expect(hasError(reparsed)).toBe(false);
    expect(code).toContain('readonly T[], at: number): T | undefined {const __beuveFrame');
  });
});

/** A syntax node, as far as finding parse errors needs it. */
interface ParsedNode {
  readonly type: string;
  readonly children: readonly unknown[];
}

function hasError(node: ParsedNode): boolean {
  return node.type === 'ERROR' || node.children.some((child) => hasError(child as ParsedNode));
}
