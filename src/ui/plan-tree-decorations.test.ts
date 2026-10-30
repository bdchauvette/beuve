import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type {
  FileImpactView,
  FunctionImpactView,
  FunctionSnapshotView,
  ImpactFindingView,
  ImpactView,
} from '#contract/ipc-contract.ts';

import { planTreeDecorations } from './plan-tree-decorations.ts';

function metrics(): FunctionImpactView['delta'] {
  return { cognitive: 1, cyclomatic: 1, lines: 3, maxNesting: 0, parameters: 0 };
}
function snapshot(): FunctionSnapshotView {
  return { startLine: 1, endLine: 3, metrics: metrics() };
}

function fn(
  name: string,
  change: 'added' | 'modified' | 'unchanged',
  percentile: number,
  where: 'in-diff' | 'outside-diff' = 'in-diff',
): FunctionImpactView {
  const common = {
    name,
    inDiff: where === 'in-diff',
    delta: metrics(),
    head: snapshot(),
    percentile,
  };
  return change === 'added' ? { ...common, change } : { ...common, change, base: snapshot() };
}

function analyzed(path: string, functions: FunctionImpactView[]): FileImpactView {
  const aggregate = {
    baseFunctions: 0,
    headFunctions: functions.length,
    baseCognitive: 0,
    headCognitive: 0,
    cognitiveDelta: 0,
    maxCognitive: 0,
    changedFunctions: functions.length,
    findings: 0,
  };
  return {
    status: 'analyzed',
    path,
    language: 'typescript',
    parseErrors: false,
    aggregate,
    functions,
  };
}

function finding(percentile: number): ImpactFindingView {
  return {
    kind: 'cognitive-complexity',
    path: 'web/b.ts',
    functionName: 'f',
    startLine: 1,
    endLine: 3,
    value: 20,
    limit: 15,
    trend: 'introduced',
    percentile,
  };
}

function impactOf(files: FileImpactView[], findings: ImpactFindingView[]): ImpactView {
  return {
    sessionId: 's',
    baseSha: 'b',
    headSha: 'h',
    cognitiveMax: 15,
    population: 10,
    files,
    findings,
    totals: {
      analyzedFiles: files.length,
      skippedFiles: 0,
      added: 0,
      removed: 0,
      modified: 0,
      cognitiveDelta: 0,
      findings: findings.length,
    },
    compute: 'PT0.001S',
  };
}

describe('planTreeDecorations', () => {
  const packageOf = new Map([
    ['web/a.ts', 'web'],
    ['web/b.ts', 'web'],
    ['top.ts', ''],
  ]);

  test('badges files and packages with their highest changed percentile and findings', ({
    expect,
  }) => {
    const impact = impactOf(
      [
        analyzed('web/a.ts', [
          fn('x', 'added', 40),
          fn('y', 'unchanged', 99),
          fn('z', 'modified', 70, 'outside-diff'),
        ]),
        analyzed('web/b.ts', [fn('w', 'modified', 96.4)]),
        analyzed('top.ts', [fn('v', 'added', 10)]),
        { status: 'skipped', path: 'img.png', reason: 'binary' },
      ],
      [finding(96.4), finding(80)],
    );
    expect(Object.fromEntries(planTreeDecorations(impact, packageOf))).toStrictEqual({
      'web/a.ts': {
        text: 'p40',
        title: 'ImpactGate: the most complex changed function in this file ranks at percentile 40',
      },
      'web/b.ts': {
        text: 'p96 ▲2',
        title:
          'ImpactGate: the most complex changed function in this file ranks at percentile 96; 2 functions over cognitive 15',
      },
      'top.ts': {
        text: 'p10',
        title: 'ImpactGate: the most complex changed function in this file ranks at percentile 10',
      },
      web: {
        text: 'p96 ▲2',
        title:
          'ImpactGate: the most complex changed function in this package ranks at percentile 96; 2 functions over cognitive 15',
      },
    });
  });

  test('is empty until the impact check answers', ({ expect }) => {
    expect(planTreeDecorations(undefined, packageOf).size).toBe(0);
  });
});
