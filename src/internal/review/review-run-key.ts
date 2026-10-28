import type { CommitSha, SessionId } from './agent-insight.ts';
import type { ReviewInput } from './review-input.ts';

/**
 * The identity of a preliminary review: one per (session, head). Main uses it to deduplicate
 * scheduled runs and to cancel the in-flight run when the head moves; the store enforces the same
 * pair as unique (`insertReviewRun`).
 */
export function reviewRunKey(input: Pick<ReviewInput, 'sessionId' | 'scope'>): string {
  return key(input.sessionId, input.scope.headSha);
}

function key(sessionId: SessionId, headSha: CommitSha): string {
  return `review:${sessionId}@${headSha}`;
}
