import type { ReviewInput } from './review-input.ts';
import { serializePathScope } from './serialize-path-scope.ts';

/**
 * The identity of a preliminary review: one per (session, head, path scope), mirroring the store's
 * unique key (`insertReviewRun`). Effort and model are not part of it (ADR 0024).
 */
export function reviewRunKey(
  input: Pick<ReviewInput, 'sessionId' | 'scope' | 'pathScope'>,
): string {
  return `review:${input.sessionId}@${input.scope.headSha}#${serializePathScope(input.pathScope ?? [])}`;
}
