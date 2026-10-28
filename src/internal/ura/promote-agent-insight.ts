import type { Result } from '#pkg/result/result.ts';

import { createUraItem } from './create-ura-item.ts';
import type {
  AgentInsightId,
  CommitSha,
  SessionId,
  UraDeps,
  UraItem,
  UraItemError,
} from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';

/** The parts of the review domain's `AgentInsight` a promotion reads; it satisfies this. */
export interface PromotableInsight {
  readonly id: AgentInsightId;
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly severity: 'info' | 'warning' | 'risk';
  readonly title: string;
  readonly body: string;
}

const defaultSeverity: Readonly<Record<PromotableInsight['severity'], UraSeverity>> = {
  risk: 'issue',
  warning: 'issue',
  info: 'nit',
};

/**
 * Turns an agent insight the reviewer promoted (`y`) into a staged item on the insight's lines.
 * An agent never blocks on its own: `risk` and `warning` become `issue`, `info` becomes `nit`,
 * unless the reviewer picked a severity.
 */
export function promoteAgentInsight(
  insight: PromotableInsight,
  deps: UraDeps,
  severity: UraSeverity = defaultSeverity[insight.severity],
): Result<UraItem, UraItemError> {
  return createUraItem(
    {
      sessionId: insight.sessionId,
      headSha: insight.headSha,
      anchor: {
        kind: 'lines',
        path: insight.path,
        startLine: insight.lineStart,
        endLine: insight.lineEnd,
      },
      severity,
      origin: { kind: 'agent-insight', insightId: insight.id },
      title: insight.title,
      body: insight.body,
    },
    deps,
  );
}
