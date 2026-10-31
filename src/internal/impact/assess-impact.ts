import { createLineMatcher } from './create-line-matcher.ts';
import { createPercentileRank } from './create-percentile-rank.ts';
import { defaultImpactConfig } from './default-impact-config.ts';
import type { ImpactConfig } from './default-impact-config.ts';
import type { FunctionMeasurement, FunctionMetrics } from './function-measurement.ts';
import type { MeasuredFile } from './impact-input.ts';
import type {
  FileAggregate,
  FileImpact,
  FunctionImpact,
  FunctionSnapshot,
  ImpactFinding,
  ImpactReport,
} from './impact-report.ts';
import { matchFunctions } from './match-functions.ts';
import type { FunctionPair } from './match-functions.ts';

type Rank = (value: number) => number;

interface FileAssessment {
  readonly impact: FileImpact;
  readonly findings: readonly ImpactFinding[];
  readonly entries: readonly FunctionImpact[];
}

const zeroMetrics: FunctionMetrics = {
  cognitive: 0,
  cyclomatic: 0,
  lines: 0,
  maxNesting: 0,
  parameters: 0,
};

/**
 * Scores the marginal impact of a change (ADR 0015): pairs each file's base and head functions,
 * computes before/after metrics and deltas, ranks head cognitive complexity against every head
 * function of the analyzed files, and reports changed functions over `cognitiveMax` as findings.
 * Pure and linear apart from one sort of the population.
 */
export function assessImpact(
  files: readonly MeasuredFile[],
  config: ImpactConfig = defaultImpactConfig,
): ImpactReport {
  const population = files.flatMap((file) => {
    return file.status === 'measured'
      ? (file.head?.functions ?? []).map(({ metrics }) => metrics.cognitive)
      : [];
  });
  const rank = createPercentileRank(population);
  const assessed = files.map((file) => assessFile(file, rank, config));
  const findings = assessed.flatMap((assessment) => assessment.findings);
  const entries = assessed.flatMap((assessment) => assessment.entries);
  const count = (...changes: FunctionImpact['change'][]): number => {
    return entries.filter((entry) => changes.includes(entry.change)).length;
  };
  return {
    cognitiveMax: config.cognitiveMax,
    population: population.length,
    files: assessed.map((assessment) => assessment.impact),
    findings,
    totals: {
      analyzedFiles: files.filter((file) => file.status === 'measured').length,
      skippedFiles: files.filter((file) => file.status === 'skipped').length,
      added: count('added'),
      removed: count('removed'),
      modified: count('modified', 'renamed'),
      cognitiveDelta: sumCognitive(entries.map(({ delta }) => delta)),
      findings: findings.length,
    },
  };
}

function assessFile(file: MeasuredFile, rank: Rank, config: ImpactConfig): FileAssessment {
  const location =
    file.previousPath === undefined
      ? { path: file.path }
      : { path: file.path, previousPath: file.previousPath };
  if (file.status === 'skipped') {
    return {
      impact: { status: 'skipped', ...location, reason: file.reason },
      findings: [],
      entries: [],
    };
  }
  const base = file.base?.functions ?? [];
  const head = file.head?.functions ?? [];
  const isHeadChanged = createLineMatcher(file.changedLines.head);
  const isBaseChanged = createLineMatcher(file.changedLines.base);
  const isInDiff = (pair: FunctionPair): boolean => {
    return (
      (pair.kind !== 'added' && isBaseChanged(pair.base.startLine, pair.base.endLine)) ||
      (pair.kind !== 'removed' && isHeadChanged(pair.head.startLine, pair.head.endLine))
    );
  };
  const entries = matchFunctions(base, head)
    .map((pair) => impactFrom(pair, isInDiff(pair), rank))
    .filter((entry) => entry.change !== 'unchanged' || entry.inDiff);
  const findings = entries.flatMap((entry) => findingFrom(file.path, entry, config));
  return {
    impact: {
      status: 'analyzed',
      ...location,
      language: file.language,
      parseErrors: (file.base?.parseErrors ?? false) || (file.head?.parseErrors ?? false),
      aggregate: aggregate(base, head, entries, findings.length),
      functions: entries.toSorted((left, right) => firstLine(left) - firstLine(right)),
    },
    findings,
    entries,
  };
}

function impactFrom(pair: FunctionPair, isInDiff: boolean, rank: Rank): FunctionImpact {
  switch (pair.kind) {
    case 'added': {
      const head = snapshot(pair.head);
      return {
        change: 'added',
        name: pair.head.name,
        inDiff: isInDiff,
        delta: subtract(head.metrics, zeroMetrics),
        head,
        percentile: rank(head.metrics.cognitive),
      };
    }
    case 'removed': {
      const base = snapshot(pair.base);
      return {
        change: 'removed',
        name: pair.base.name,
        inDiff: isInDiff,
        delta: subtract(zeroMetrics, base.metrics),
        base,
      };
    }
    case 'matched':
    case 'renamed': {
      const base = snapshot(pair.base);
      const head = snapshot(pair.head);
      const common = {
        name: pair.head.name,
        inDiff: isInDiff,
        delta: subtract(head.metrics, base.metrics),
        base,
        head,
        percentile: rank(head.metrics.cognitive),
      };
      if (pair.kind === 'renamed') {
        return { change: 'renamed', previousName: pair.base.name, ...common };
      }
      return {
        change: pair.base.textHash === pair.head.textHash ? 'unchanged' : 'modified',
        ...common,
      };
    }
  }
}

function findingFrom(
  path: string,
  entry: FunctionImpact,
  config: ImpactConfig,
): readonly ImpactFinding[] {
  if (entry.change === 'removed' || entry.change === 'unchanged') {
    return [];
  }
  const value = entry.head.metrics.cognitive;
  if (value <= config.cognitiveMax) {
    return [];
  }
  const baseValue = entry.change === 'added' ? undefined : entry.base.metrics.cognitive;
  return [
    {
      kind: 'cognitive-complexity',
      path,
      functionName: entry.name,
      startLine: entry.head.startLine,
      endLine: entry.head.endLine,
      value,
      limit: config.cognitiveMax,
      baseValue,
      trend: trend(value, baseValue, config.cognitiveMax),
      percentile: entry.percentile,
    },
  ];
}

function trend(
  value: number,
  baseValue: number | undefined,
  limit: number,
): ImpactFinding['trend'] {
  if (baseValue === undefined || baseValue <= limit) {
    return 'introduced';
  }
  if (value === baseValue) {
    return 'unchanged';
  }
  return value > baseValue ? 'worsened' : 'improved';
}

function aggregate(
  base: readonly FunctionMeasurement[],
  head: readonly FunctionMeasurement[],
  entries: readonly FunctionImpact[],
  findings: number,
): FileAggregate {
  const baseCognitive = sumCognitive(base.map(({ metrics }) => metrics));
  const headCognitive = sumCognitive(head.map(({ metrics }) => metrics));
  return {
    baseFunctions: base.length,
    headFunctions: head.length,
    baseCognitive,
    headCognitive,
    cognitiveDelta: headCognitive - baseCognitive,
    maxCognitive: Math.max(0, ...head.map(({ metrics }) => metrics.cognitive)),
    changedFunctions: entries.filter((entry) => entry.change !== 'unchanged').length,
    findings,
  };
}

function sumCognitive(metrics: readonly FunctionMetrics[]): number {
  let total = 0;
  for (const { cognitive } of metrics) {
    total += cognitive;
  }
  return total;
}

function snapshot(measurement: FunctionMeasurement): FunctionSnapshot {
  const { startLine, endLine, metrics } = measurement;
  return { startLine, endLine, metrics };
}

function subtract(left: FunctionMetrics, right: FunctionMetrics): FunctionMetrics {
  return {
    cognitive: left.cognitive - right.cognitive,
    cyclomatic: left.cyclomatic - right.cyclomatic,
    lines: left.lines - right.lines,
    maxNesting: left.maxNesting - right.maxNesting,
    parameters: left.parameters - right.parameters,
  };
}

function firstLine(entry: FunctionImpact): number {
  return entry.change === 'removed' ? entry.base.startLine : entry.head.startLine;
}
