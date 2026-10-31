import type { Result } from '#x/result/result.ts';

import { createUraItem } from './create-ura-item.ts';
import { formatOrdinal } from './format-ordinal.ts';
import type { CommitSha, SessionId, UraDeps, UraItem, UraItemError } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';

/** The impact domain's `ImpactFinding` satisfies this structurally. */
export interface StageableFinding {
  readonly kind: 'cognitive-complexity';
  readonly path: string;
  readonly functionName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly value: number;
  readonly limit: number;
  readonly baseValue: number | undefined;
  readonly trend: 'introduced' | 'worsened' | 'unchanged' | 'improved';
  readonly percentile: number;
}

/** Which review the finding came from: ImpactGate findings don't name their session or head. */
export interface FindingContext {
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
}

const maxTitleLength = 200;

/**
 * Stages an ImpactGate finding as an item on its function's head lines, keeping the metric,
 * value, threshold and percentile. A function this change pushed over the limit (`introduced`,
 * `worsened`) is an `issue`; one that was already over it and didn't get worse is a `nit`.
 */
export function stageImpactFinding(
  finding: StageableFinding,
  context: FindingContext,
  deps: UraDeps,
): Result<UraItem, UraItemError> {
  return createUraItem(
    {
      sessionId: context.sessionId,
      headSha: context.headSha,
      anchor: {
        kind: 'lines',
        path: finding.path,
        startLine: finding.startLine,
        endLine: finding.endLine,
      },
      severity: severityFor(finding),
      origin: {
        kind: 'impact-finding',
        metric: finding.kind,
        functionName: finding.functionName,
        value: finding.value,
        threshold: finding.limit,
        percentile: finding.percentile,
      },
      title: title(finding),
      body: body(finding),
    },
    deps,
  );
}

function title(finding: StageableFinding): string {
  const text = `Cognitive complexity ${String(finding.value)} exceeds ${String(finding.limit)} in ${finding.functionName}`;
  if (text.length > maxTitleLength) {
    return `${text.slice(0, maxTitleLength - 1)}…`;
  }
  return text;
}

/** A finding that got worse is an issue; one that was already over the limit is a nit. */
function severityFor(finding: StageableFinding): UraSeverity {
  if (finding.trend === 'introduced' || finding.trend === 'worsened') {
    return 'issue';
  }
  return 'nit';
}

function body(finding: StageableFinding): string {
  let base = 'The function is new.';
  if (finding.baseValue !== undefined) {
    base = `It was ${String(finding.baseValue)} at the base (${finding.trend}).`;
  }
  return [
    `ImpactGate measured a cognitive complexity of ${String(finding.value)} for \`${finding.functionName}\`, over the limit of ${String(finding.limit)}. ${base}`,
    `It ranks at the ${formatOrdinal(Math.round(finding.percentile))} percentile of the functions in this change.`,
  ].join('\n\n');
}
