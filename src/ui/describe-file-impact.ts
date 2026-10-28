import type {
  FileImpactView,
  ImpactFindingView,
  ImpactSkipReason,
} from '#contract/ipc-contract.ts';

/** What a file card's ImpactGate banner says, and whether it warns. */
export interface ImpactBanner {
  readonly tone: 'warning' | 'neutral';
  readonly text: string;
  readonly title: string;
}

const skipLabel: Readonly<Record<ImpactSkipReason, string>> = {
  'unsupported-language': 'unsupported language',
  'too-large': 'too large',
  'parse-failed': 'could not parse',
  binary: 'binary file',
  submodule: 'submodule',
  'no-source': 'no source text',
};

/**
 * The banner for one file: the worst finding ("cognitive 22 (max 15) in handleAuth · 96th pctl")
 * when there are any, otherwise the file's aggregate. Nothing for files ImpactGate doesn't read
 * or where no function changed.
 */
export function describeFileImpact(
  file: FileImpactView | undefined,
  findings: readonly ImpactFindingView[],
): ImpactBanner | undefined {
  if (file === undefined || file.status === 'skipped') {
    return file?.status === 'skipped' && file.reason !== 'unsupported-language'
      ? { tone: 'neutral', text: `skipped: ${skipLabel[file.reason]}`, title: '' }
      : undefined;
  }
  const own = findings
    .filter((finding) => finding.path === file.path)
    .toSorted((a, b) => b.value - a.value);
  const [worst] = own;
  if (worst !== undefined) {
    const more = own.length > 1 ? ` · +${String(own.length - 1)} more` : '';
    return {
      tone: 'warning',
      text: `cognitive ${String(worst.value)} (max ${String(worst.limit)}) in ${worst.functionName} · ${ordinal(Math.round(worst.percentile))} pctl${more}`,
      title: own.map((finding) => findingTitle(finding)).join('\n'),
    };
  }
  const { aggregate } = file;
  const changed = aggregate.changedFunctions;
  if (changed === 0) {
    return undefined;
  }
  return {
    tone: 'neutral',
    text: `cognitive ${signed(aggregate.cognitiveDelta)} · max ${String(aggregate.maxCognitive)} · ${String(changed)} ${changed === 1 ? 'function' : 'functions'} changed`,
    title: file.parseErrors ? 'Syntax errors in this file may skew the metrics.' : '',
  };
}

function findingTitle(finding: ImpactFindingView): string {
  const base = finding.baseValue === undefined ? 'new' : `was ${String(finding.baseValue)}`;
  return `${finding.functionName} (lines ${String(finding.startLine)}–${String(finding.endLine)}): cognitive ${String(finding.value)}, ${base}, ${finding.trend}`;
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${String(value)}th`;
  }
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th';
  return `${String(value)}${suffix}`;
}
