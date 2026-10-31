import type {
  FileImpactView,
  FunctionImpactView,
  FunctionSnapshotView,
  ImpactFindingView,
  ImpactView,
} from '#contract/ipc-contract.ts';
import type {
  FileImpact,
  FunctionImpact,
  FunctionSnapshot,
  ImpactFinding,
  ImpactReport,
} from '#internal/impact/impact-report.ts';

import type { PreSkippedFile } from './assemble-impact-input.ts';

export interface ImpactViewSource {
  readonly sessionId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly report: ImpactReport;
  readonly skipped: readonly PreSkippedFile[];
  /** Head paths in diff order; the view lists files in this order. */
  readonly order: readonly string[];
  readonly compute: Temporal.Duration;
}

/** Maps an ImpactGate report and the files skipped before parsing to the contract view. */
export function impactViewFrom(source: ImpactViewSource): ImpactView {
  const { report } = source;
  const byPath = new Map<string, FileImpactView>();
  for (const file of report.files) {
    byPath.set(file.path, fileViewFrom(file));
  }
  for (const file of source.skipped) {
    byPath.set(file.path, {
      status: 'skipped',
      path: file.path,
      ...(file.previousPath !== undefined && { previousPath: file.previousPath }),
      reason: file.reason,
    });
  }
  const files = source.order.flatMap((path) => {
    const view = byPath.get(path);
    if (view === undefined) {
      return [];
    }
    return [view];
  });
  return {
    sessionId: source.sessionId,
    baseSha: source.baseSha,
    headSha: source.headSha,
    cognitiveMax: report.cognitiveMax,
    population: report.population,
    files,
    findings: report.findings.map((finding) => findingViewFrom(finding)),
    totals: { ...report.totals, skippedFiles: report.totals.skippedFiles + source.skipped.length },
    compute: source.compute.toString({ smallestUnit: 'millisecond' }),
  };
}

function fileViewFrom(file: FileImpact): FileImpactView {
  const location = {
    path: file.path,
    ...(file.previousPath !== undefined && { previousPath: file.previousPath }),
  };
  if (file.status === 'skipped') {
    return { status: 'skipped', ...location, reason: file.reason };
  }
  return {
    status: 'analyzed',
    ...location,
    language: file.language,
    parseErrors: file.parseErrors,
    aggregate: { ...file.aggregate },
    functions: file.functions.map((entry) => functionViewFrom(entry)),
  };
}

function functionViewFrom(entry: FunctionImpact): FunctionImpactView {
  const common = { name: entry.name, inDiff: entry.inDiff, delta: { ...entry.delta } };
  switch (entry.change) {
    case 'added': {
      return {
        ...common,
        change: 'added',
        head: snapshotFrom(entry.head),
        percentile: entry.percentile,
      };
    }
    case 'removed': {
      return { ...common, change: 'removed', base: snapshotFrom(entry.base) };
    }
    case 'modified':
    case 'unchanged': {
      return {
        ...common,
        change: entry.change,
        base: snapshotFrom(entry.base),
        head: snapshotFrom(entry.head),
        percentile: entry.percentile,
      };
    }
    case 'renamed': {
      return {
        ...common,
        change: 'renamed',
        previousName: entry.previousName,
        base: snapshotFrom(entry.base),
        head: snapshotFrom(entry.head),
        percentile: entry.percentile,
      };
    }
  }
}

function snapshotFrom(snapshot: FunctionSnapshot): FunctionSnapshotView {
  return {
    startLine: snapshot.startLine,
    endLine: snapshot.endLine,
    metrics: { ...snapshot.metrics },
  };
}

function findingViewFrom(finding: ImpactFinding): ImpactFindingView {
  const { baseValue, ...rest } = finding;
  if (baseValue === undefined) {
    return { ...rest };
  }
  return { ...rest, baseValue };
}
