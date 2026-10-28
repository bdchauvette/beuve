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
  readonly computeMs: number;
}

/** Maps an ImpactGate report and the files skipped before parsing to the contract view. */
export function toImpactView(source: ImpactViewSource): ImpactView {
  const { report } = source;
  const byPath = new Map<string, FileImpactView>();
  for (const file of report.files) {
    byPath.set(file.path, toFileView(file));
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
    return view === undefined ? [] : [view];
  });
  return {
    sessionId: source.sessionId,
    baseSha: source.baseSha,
    headSha: source.headSha,
    cognitiveMax: report.cognitiveMax,
    population: report.population,
    files,
    findings: report.findings.map((finding) => toFindingView(finding)),
    totals: { ...report.totals, skippedFiles: report.totals.skippedFiles + source.skipped.length },
    computeMs: source.computeMs,
  };
}

function toFileView(file: FileImpact): FileImpactView {
  const location =
    file.previousPath === undefined
      ? { path: file.path }
      : { path: file.path, previousPath: file.previousPath };
  return file.status === 'skipped'
    ? { status: 'skipped', ...location, reason: file.reason }
    : {
        status: 'analyzed',
        ...location,
        language: file.language,
        parseErrors: file.parseErrors,
        aggregate: { ...file.aggregate },
        functions: file.functions.map((entry) => toFunctionView(entry)),
      };
}

function toFunctionView(entry: FunctionImpact): FunctionImpactView {
  const common = { name: entry.name, inDiff: entry.inDiff, delta: { ...entry.delta } };
  switch (entry.change) {
    case 'added': {
      return {
        ...common,
        change: 'added',
        head: toSnapshot(entry.head),
        percentile: entry.percentile,
      };
    }
    case 'removed': {
      return { ...common, change: 'removed', base: toSnapshot(entry.base) };
    }
    case 'modified':
    case 'unchanged': {
      return {
        ...common,
        change: entry.change,
        base: toSnapshot(entry.base),
        head: toSnapshot(entry.head),
        percentile: entry.percentile,
      };
    }
    case 'renamed': {
      return {
        ...common,
        change: 'renamed',
        previousName: entry.previousName,
        base: toSnapshot(entry.base),
        head: toSnapshot(entry.head),
        percentile: entry.percentile,
      };
    }
  }
}

function toSnapshot(snapshot: FunctionSnapshot): FunctionSnapshotView {
  return {
    startLine: snapshot.startLine,
    endLine: snapshot.endLine,
    metrics: { ...snapshot.metrics },
  };
}

function toFindingView(finding: ImpactFinding): ImpactFindingView {
  const { baseValue, ...rest } = finding;
  return baseValue === undefined ? { ...rest } : { ...rest, baseValue };
}
