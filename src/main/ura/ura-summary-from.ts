import type { CommitSha } from '#internal/ura/ura-item.ts';
import type { UraSummary } from '#internal/ura/ura-artifact.ts';

import type { ReviewDiff } from '../sessions/load-review-diff.ts';

/**
 * The artifact summary for the review the reviewer is shown: the session source, the fork point
 * and the head. An interdiff stays one only when it is trustworthy; a fallback showed the full
 * change, and an up-to-date review is about the whole change too (ADR 0022's precedent).
 */
export function uraSummaryFrom(diff: ReviewDiff): UraSummary {
  const { session } = diff.refreshed;
  return {
    sessionId: session.id,
    change: session.source,
    baseSha: diff.baseSha,
    headSha: session.headSha,
    scope: summaryScopeOf(diff.scope),
  };
}

function summaryScopeOf(scope: ReviewDiff['scope']): UraSummary['scope'] {
  if (scope.kind === 'interdiff' && scope.outcome.kind !== 'fallback') {
    return { kind: 'interdiff', fromHeadSha: scope.fromHeadSha as CommitSha };
  }
  return { kind: 'full' };
}
