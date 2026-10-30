import { describe, expect, it } from 'vitest';

import type {
  FileImpactView,
  FunctionImpactView,
  FunctionMetricsView,
  ImpactView,
} from '#contract/ipc-contract.ts';

import { slimImpactView } from './slim-impact-view.ts';

const zero: FunctionMetricsView = {
  cognitive: 0,
  cyclomatic: 0,
  lines: 0,
  maxNesting: 0,
  parameters: 0,
};

describe('slimImpactView', () => {
  it('keeps the eight worst changed functions per file and counts the rest', () => {
    const functions = Array.from({ length: 12 }, (_, index) => added(`f${String(index)}`, index));
    const rows = [...functions, unchanged(99)];
    const file = slimImpactView(view([analyzed('a.ts', rows)])).files[0];
    expect(file?.status === 'analyzed' && file.functions.map((entry) => entry.name)).toEqual([
      'f11',
      'f10',
      'f9',
      'f8',
      'f7',
      'f6',
      'f5',
      'f4',
    ]);
    expect(file).toMatchObject({ omittedFunctions: 4 });
  });

  it('drops unchanged and out-of-diff rows, sorts removed ones last, and omits a zero count', () => {
    const outside: FunctionImpactView = { ...added('outside', 50), inDiff: false };
    const removed: FunctionImpactView = {
      name: 'gone',
      change: 'removed',
      inDiff: true,
      delta: zero,
      base: { startLine: 1, endLine: 2, metrics: { ...zero, cognitive: 40 } },
    };
    const rows = [removed, unchanged(7), outside, added('new', 1)];
    const file = slimImpactView(view([analyzed('a.ts', rows)])).files[0];
    expect(file?.status === 'analyzed' && file.functions.map((entry) => entry.name)).toEqual([
      'new',
      'gone',
    ]);
    expect(file).not.toHaveProperty('omittedFunctions');
  });

  it('leaves findings, totals and skipped files alone', () => {
    const skipped: FileImpactView = { status: 'skipped', path: 'b.bin', reason: 'binary' };
    const source = view([skipped]);
    expect(slimImpactView(source)).toEqual(source);
  });

  it('is much smaller than the full view for a large file', () => {
    const functions = Array.from({ length: 2000 }, (_, index) => added(`f${String(index)}`, index));
    const full = view([analyzed('big.ts', functions)]);
    expect(JSON.stringify(slimImpactView(full)).length).toBeLessThan(
      JSON.stringify(full).length / 50,
    );
  });
});

function added(name: string, cognitive: number): FunctionImpactView {
  return {
    name,
    change: 'added',
    inDiff: true,
    delta: { ...zero, cognitive },
    head: { startLine: 1, endLine: 5, metrics: { ...zero, cognitive } },
    percentile: 50,
  };
}

function unchanged(cognitive: number): FunctionImpactView {
  const snapshot = { startLine: 1, endLine: 5, metrics: { ...zero, cognitive } };
  return {
    name: 'unchanged',
    change: 'unchanged',
    inDiff: true,
    delta: zero,
    base: snapshot,
    head: snapshot,
    percentile: 90,
  };
}

function analyzed(path: string, functions: FunctionImpactView[]): FileImpactView {
  return {
    status: 'analyzed',
    path,
    language: 'typescript',
    parseErrors: false,
    aggregate: {
      baseFunctions: 0,
      headFunctions: functions.length,
      baseCognitive: 0,
      headCognitive: 0,
      cognitiveDelta: 0,
      maxCognitive: 0,
      changedFunctions: functions.length,
      findings: 0,
    },
    functions,
  };
}

function view(files: FileImpactView[]): ImpactView {
  return {
    sessionId: 's',
    baseSha: 'b',
    headSha: 'h',
    cognitiveMax: 15,
    population: 10,
    files,
    findings: [],
    totals: {
      analyzedFiles: 1,
      skippedFiles: 0,
      added: 0,
      removed: 0,
      modified: 0,
      cognitiveDelta: 0,
      findings: 0,
    },
    compute: 'PT0.001S',
  };
}
