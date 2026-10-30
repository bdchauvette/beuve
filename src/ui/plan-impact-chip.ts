import type {
  FileImpactView,
  FunctionImpactView,
  ImpactFindingView,
  ImpactSkipReason,
} from '#contract/ipc-contract.ts';

/** One changed function in the ImpactGate popover. */
export interface ImpactChipRow {
  readonly name: string;
  /** `12–30`, the head lines (base lines for a removed function). */
  readonly lines: string;
  readonly change: FunctionImpactView['change'];
  /** Cognitive complexity on the base side; absent for an added function. */
  readonly before?: number;
  /** On the head side; absent for a removed function. */
  readonly after?: number;
  /** Rank of the head value among the head's functions, 0–100. */
  readonly percentile?: number;
  /** Set when the function is over the limit: how the change moved it. */
  readonly trend?: ImpactFindingView['trend'];
}

/**
 * The ImpactGate indicator in a file card's title bar (ADR 0042): a warning chip naming the worst
 * breach (`cognitive 23`), a quiet neutral mark for an analyzed change without findings, or a
 * neutral `skipped` note; and the details its popover shows.
 */
export interface ImpactChip {
  readonly tone: 'warning' | 'quiet' | 'skipped';
  /** The chip's text; empty for the quiet mark, which is only an icon. */
  readonly label: string;
  /** The popover's first line. */
  readonly summary: string;
  readonly rows: readonly ImpactChipRow[];
  /** Findings of this file, which the popover's Stage button stages. */
  readonly findings: readonly ImpactFindingView[];
  readonly note: string;
}

const maxRows = 8;

const skipLabel: Readonly<Record<ImpactSkipReason, string>> = {
  'unsupported-language': 'unsupported language',
  'too-large': 'too large',
  'parse-failed': 'could not parse',
  binary: 'binary file',
  submodule: 'submodule',
  'no-source': 'no source text',
};

/**
 * Plans the indicator for one file. Nothing before the check has run, for languages ImpactGate
 * doesn't read, or when no function changed. Findings make a warning chip with the worst value
 * (`+1` when there are more); otherwise the change gets a quiet mark. Rows list the changed
 * functions in the diff, worst head value first, at most eight.
 */
export function planImpactChip(
  file: FileImpactView | undefined,
  findings: readonly ImpactFindingView[],
  limit: number | undefined,
): ImpactChip | undefined {
  if (file === undefined || file.status === 'skipped') {
    return file?.status === 'skipped' && file.reason !== 'unsupported-language'
      ? {
          tone: 'skipped',
          label: 'skipped',
          summary: `ImpactGate skipped this file: ${skipLabel[file.reason]}.`,
          rows: [],
          findings: [],
          note: '',
        }
      : undefined;
  }
  const own = findings
    .filter((finding) => finding.path === file.path)
    .toSorted((a, b) => b.value - a.value);
  const { aggregate } = file;
  if (own.length === 0 && aggregate.changedFunctions === 0) {
    return undefined;
  }
  const byName = new Map(own.map((finding) => [finding.functionName, finding]));
  const changed = file.functions
    .filter((entry) => entry.inDiff && entry.change !== 'unchanged')
    .toSorted((a, b) => headValue(b) - headValue(a));
  const hidden = Math.max(0, changed.length - maxRows) + (file.omittedFunctions ?? 0);
  const rows = changed.slice(0, maxRows).map((entry) => rowFrom(entry, byName.get(entry.name)));
  const count = aggregate.changedFunctions;
  const max = limit === undefined ? '' : ` (limit ${String(limit)})`;
  const summary = `Cognitive ${signed(aggregate.cognitiveDelta)} · max ${String(aggregate.maxCognitive)}${max} · ${String(count)} ${count === 1 ? 'function' : 'functions'} changed`;
  const notes = [
    ...(hidden > 0 ? [`${String(hidden)} more not shown.`] : []),
    ...(file.parseErrors ? ['Syntax errors in this file may skew the metrics.'] : []),
  ];
  const [worst] = own;
  return {
    tone: worst === undefined ? 'quiet' : 'warning',
    label:
      worst === undefined
        ? ''
        : `cognitive ${String(worst.value)}${own.length > 1 ? ` +${String(own.length - 1)}` : ''}`,
    summary,
    rows,
    findings: own,
    note: notes.join(' '),
  };
}

function rowFrom(entry: FunctionImpactView, finding: ImpactFindingView | undefined): ImpactChipRow {
  const shown = entry.change === 'removed' ? entry.base : entry.head;
  return {
    name: entry.name,
    lines: `${String(shown.startLine)}–${String(shown.endLine)}`,
    change: entry.change,
    ...(entry.change !== 'added' && { before: entry.base.metrics.cognitive }),
    ...(entry.change !== 'removed' && {
      after: entry.head.metrics.cognitive,
      percentile: Math.round(entry.percentile),
    }),
    ...(finding !== undefined && { trend: finding.trend }),
  };
}

function headValue(entry: FunctionImpactView): number {
  return entry.change === 'removed' ? -1 : entry.head.metrics.cognitive;
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}
