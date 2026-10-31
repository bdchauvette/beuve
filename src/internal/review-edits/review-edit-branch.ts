import type { Brand } from '#x/brand/brand.ts';

/** A review session's id; structurally the session domain's `SessionId` (ADR 0009). */
export type SessionId = Brand<string, 'SessionId'>;

/** A full, lowercase commit id; structurally the git and session domains' brand. */
export type CommitSha = Brand<string, 'CommitSha'>;

/**
 * The local branch beuve made for a session's review edits (ADR 0088), starting at `baseSha`,
 * the head the reviewer was reviewing. Never pushed.
 */
export interface ReviewEditBranch {
  readonly sessionId: SessionId;
  readonly repoPath: string;
  readonly branch: string;
  readonly baseSha: CommitSha;
  readonly createdAt: string;
}

/** Which URA item one harvested edit became, and the content it carried then. */
export interface EditSuggestion {
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  /** The edit's target: path and head lines, or a whole-file or whole-change key. */
  readonly target: string;
  readonly itemId: string;
  /** A digest of the patch or note body the item was given. */
  readonly fingerprint: string;
}

/** Expected failures of the review-edits store. */
export type ReviewEditsStoreError =
  | { readonly kind: 'branch-taken'; readonly repoPath: string; readonly branch: string }
  | { readonly kind: 'session-taken'; readonly sessionId: SessionId }
  | {
      readonly kind: 'corrupt-row';
      readonly table: 'review_edit_branches' | 'review_edit_suggestions';
      readonly reason: string;
    };
