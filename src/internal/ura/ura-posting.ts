import type { CommitSha, SessionId, UraItemId } from './ura-item.ts';

/**
 * A staged item carried by a review posted elsewhere (ADR 0039): where it went, as an inline
 * comment or in the review body, on which head, and when. Posting doesn't change an item's status.
 */
export interface UraPosting {
  readonly itemId: UraItemId;
  readonly sessionId: SessionId;
  readonly target: 'github';
  /** The posted review's web URL. */
  readonly url: string;
  readonly headSha: CommitSha;
  readonly placement: 'inline' | 'body';
  readonly postedAt: string;
}
