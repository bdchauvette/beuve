import type { CommitSha, SessionId, UraItemId } from './ura-item.ts';

/** A part of a note a posted review can carry on its own: its text, or one of its suggestions. */
export type UraPostingPiece =
  | { readonly kind: 'note' }
  | {
      readonly kind: 'suggestion';
      /** The suggestion's 0-based position in the note's list. */
      readonly position: number;
    };

/**
 * Where a piece went (ADR 0162): the note's own inline comment (its text, or a suggestion
 * condensed into it), a suggestion's separate inline comment, or the note's `<details>` section
 * in the review body.
 */
export type UraPostingPlacement = 'comment' | 'suggestion-comment' | 'body';

/**
 * One piece of a staged note carried by a review posted elsewhere (ADR 0039, 0162): which piece,
 * where it went, on which head, and when. A note counts as posted once all its pieces were
 * (`isUraItemPosted`). Posting doesn't change an item's status.
 */
export interface UraPosting {
  readonly itemId: UraItemId;
  readonly sessionId: SessionId;
  readonly target: 'github';
  readonly piece: UraPostingPiece;
  /** The posted review's web URL. */
  readonly url: string;
  readonly headSha: CommitSha;
  readonly placement: UraPostingPlacement;
  readonly postedAt: string;
}
