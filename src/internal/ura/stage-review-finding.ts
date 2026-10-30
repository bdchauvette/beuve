import type { Result } from '#x/result/result.ts';

import { createUraItem } from './create-ura-item.ts';
import type { CommitSha, SessionId, UraDeps, UraItem, UraItemError } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';

/** The parts of a chat `/review` finding (ADR 0055) staging reads; the chat domain's satisfies it. */
export interface StageableReviewFinding {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: 'info' | 'warning' | 'risk';
  readonly title: string;
  readonly body: string;
}

/** Which answer the finding belongs to, and where in it. */
export interface ReviewFindingSource {
  readonly sessionId: SessionId;
  /** The head the review answered at, which the finding's lines refer to. */
  readonly headSha: CommitSha;
  readonly messageId: string;
  /** 0-based, in the answer's order. */
  readonly finding: number;
}

const defaultSeverity: Readonly<Record<StageableReviewFinding['severity'], UraSeverity>> = {
  risk: 'issue',
  warning: 'issue',
  info: 'nit',
};

/**
 * Turns a `/review` finding the reviewer staged into an item on its lines, with a `chat-answer`
 * origin naming the answer and the finding. An agent never blocks on its own: `risk` and
 * `warning` become `issue`, `info` becomes `nit`, unless the reviewer picked a severity.
 */
export function stageReviewFinding(
  finding: StageableReviewFinding,
  source: ReviewFindingSource,
  deps: UraDeps,
  severity: UraSeverity = defaultSeverity[finding.severity],
): Result<UraItem, UraItemError> {
  return createUraItem(
    {
      sessionId: source.sessionId,
      headSha: source.headSha,
      anchor: {
        kind: 'lines',
        path: finding.path,
        startLine: finding.startLine,
        endLine: finding.endLine,
      },
      severity,
      origin: { kind: 'chat-answer', messageId: source.messageId, finding: source.finding },
      title: finding.title,
      body: finding.body,
    },
    deps,
  );
}
