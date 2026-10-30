import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type {
  FileImpactView,
  FunctionImpactView,
  FunctionMetricsView,
  ImpactFindingView,
} from '#contract/ipc-contract.ts';

import { planImpactChip } from './plan-impact-chip.ts';

function metrics(cognitive: number): FunctionMetricsView {
  return { cognitive, cyclomatic: 1, lines: 10, maxNesting: 1, parameters: 1 };
}

function handle(): FunctionImpactView {
  return {
    name: 'handleAuth',
    inDiff: true,
    delta: metrics(18),
    change: 'modified',
    base: { startLine: 3, endLine: 20, metrics: metrics(4) },
    head: { startLine: 3, endLine: 30, metrics: metrics(22) },
    percentile: 96.4,
  };
}

function added(): FunctionImpactView {
  return {
    name: 'helper',
    inDiff: true,
    delta: metrics(2),
    change: 'added',
    head: { startLine: 32, endLine: 36, metrics: metrics(2) },
    percentile: 40,
  };
}

function untouched(): FunctionImpactView {
  return { ...handle(), name: 'other', inDiff: false };
}

function analyzed(
  functions: readonly FunctionImpactView[],
  changed: number,
): Extract<FileImpactView, { status: 'analyzed' }> {
  return {
    status: 'analyzed',
    path: 'src/auth.ts',
    language: 'typescript',
    parseErrors: false,
    aggregate: {
      baseFunctions: 2,
      headFunctions: 3,
      baseCognitive: 4,
      headCognitive: 30,
      cognitiveDelta: 20,
      maxCognitive: 22,
      changedFunctions: changed,
      findings: 1,
    },
    functions,
  };
}

function finding(functionName: string, value: number): ImpactFindingView {
  return {
    kind: 'cognitive-complexity',
    path: 'src/auth.ts',
    functionName,
    startLine: 3,
    endLine: 30,
    value,
    limit: 15,
    baseValue: 4,
    trend: 'worsened',
    percentile: 96,
  };
}

function skipped(reason: 'too-large' | 'unsupported-language'): FileImpactView {
  return { status: 'skipped', path: 'a', reason };
}

describe('planImpactChip', () => {
  test('warns with the worst breach and lists the changed functions, worst first', ({ expect }) => {
    const chip = planImpactChip(
      analyzed([added(), untouched(), handle()], 2),
      [finding('handleAuth', 22), finding('helper', 16), { ...finding('x', 30), path: 'b.ts' }],
      15,
    );
    expect(chip).toMatchObject({
      tone: 'warning',
      label: 'cognitive 22 +1',
      summary: 'Cognitive +20 · max 22 (limit 15) · 2 functions changed',
      note: '',
    });
    expect(chip?.findings.map((entry) => entry.functionName)).toStrictEqual([
      'handleAuth',
      'helper',
    ]);
    expect(chip?.rows).toStrictEqual([
      {
        name: 'handleAuth',
        lines: '3–30',
        change: 'modified',
        before: 4,
        after: 22,
        percentile: 96,
        trend: 'worsened',
      },
      {
        name: 'helper',
        lines: '32–36',
        change: 'added',
        after: 2,
        percentile: 40,
        trend: 'worsened',
      },
    ]);
  });

  test('is a quiet mark for a change without findings, and nothing without changed functions', ({
    expect,
  }) => {
    const changed = analyzed([added()], 1);
    expect(planImpactChip(changed, [], 15)).toMatchObject({
      tone: 'quiet',
      label: '',
      summary: 'Cognitive +20 · max 22 (limit 15) · 1 function changed',
    });
    expect(planImpactChip(analyzed([], 0), [], 15)).toBeUndefined();
    expect(planImpactChip(undefined, [], 15)).toBeUndefined();
  });

  test('says why a file was skipped, except for languages ImpactGate does not read', ({
    expect,
  }) => {
    expect(planImpactChip(skipped('too-large'), [], 15)).toMatchObject({
      tone: 'skipped',
      summary: 'ImpactGate skipped this file: too large.',
    });
    expect(planImpactChip(skipped('unsupported-language'), [], 15)).toBeUndefined();
  });

  test('notes parse errors and functions beyond the first eight', ({ expect }) => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      ...added(),
      name: `f${String(index)}`,
    }));
    const chip = planImpactChip({ ...analyzed(many, 10), parseErrors: true }, [], undefined);
    expect(chip?.rows).toHaveLength(8);
    expect(chip?.summary).toBe('Cognitive +20 · max 22 · 10 functions changed');
    expect(chip?.note).toBe('2 more not shown. Syntax errors in this file may skew the metrics.');
  });
});
