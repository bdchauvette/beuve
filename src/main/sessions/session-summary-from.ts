import type { SessionSummary } from '#contract/ipc-contract.ts';
import type { Session } from '#internal/session/session.ts';

/** Flattens a domain session to the contract's plain-data view (ADR 0011). */
export function sessionSummaryFrom(session: Session): SessionSummary {
  const summary: SessionSummary = {
    id: session.id,
    source: { ...session.source },
    headSha: session.headSha,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  if (session.review.kind === 'reviewed') {
    return { ...summary, lastReviewedSha: session.review.checkpoint.headSha };
  }
  return summary;
}
