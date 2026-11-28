import type { CommitSha, SessionId, UraAnchor, UraItem, UraSuggestion } from './ura-item.ts';

/** What the review asks of the author, as a GitHub review event would say it. */
export type UraVerdict = 'approve' | 'request-changes' | 'comment';

/**
 * The change under review. `change` has the session domain's `SessionSource` shape, so main can
 * pass `session.source` straight in. `baseSha` is the fork point the review was diffed against.
 */
export interface UraSummary {
  readonly sessionId: SessionId;
  readonly change:
    | {
        readonly kind: 'local';
        readonly repoPath: string;
        readonly baseRef: string;
        readonly headRef: string;
      }
    | {
        readonly kind: 'github-pull-request';
        readonly repoPath: string;
        readonly baseRef: string;
        readonly owner: string;
        readonly repo: string;
        readonly number: number;
      }
    | {
        readonly kind: 'remote-branch';
        readonly repoPath: string;
        readonly baseRef: string;
        readonly host: string;
        readonly owner: string;
        readonly repo: string;
        readonly branch: string;
      };
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
  readonly scope:
    { readonly kind: 'full' } | { readonly kind: 'interdiff'; readonly fromHeadSha: CommitSha };
}

/** Why an item can no longer be placed on the artifact's head. */
export type OutdatedReason = 'lines-changed' | 'file-deleted' | 'no-line-mapping';

/** Where an item sits on the artifact's head. */
export type UraPlacement =
  | { readonly kind: 'current'; readonly anchor: UraAnchor }
  | { readonly kind: 'outdated'; readonly reason: OutdatedReason };

/** Where a suggestion sits on the artifact's head: its lines there, or why it can't be placed. */
export type UraSuggestionPlacement =
  | { readonly kind: 'current'; readonly suggestion: UraSuggestion }
  | { readonly kind: 'outdated'; readonly reason: OutdatedReason };

/** One of an item's suggestions, placed on the artifact's head on its own (ADR 0162). */
export interface UraPlacedSuggestion {
  /** As written, on the head the item was written against. */
  readonly suggestion: UraSuggestion;
  readonly placement: UraSuggestionPlacement;
  /**
   * The unified diff `suggestedPatchFrom` derives against the head the item was written against;
   * absent when that file's text wasn't given, or the suggestion is out of its range or changes
   * nothing.
   */
  readonly patch?: string;
}

export interface UraEntry {
  readonly item: UraItem;
  readonly placement: UraPlacement;
  /** The item's suggestions in order, each placed on its own; outdated ones are kept. */
  readonly suggestions: readonly UraPlacedSuggestion[];
}

/** The derived verdict, or the reviewer's choice with the derived one kept for reference. */
export type UraArtifactVerdict =
  | { readonly value: UraVerdict; readonly source: 'derived' }
  | { readonly value: UraVerdict; readonly source: 'chosen'; readonly derived: UraVerdict };

/** The reviewer's staged decisions on one head, in note order: what every exporter reads. */
export interface UraArtifact {
  readonly summary: UraSummary;
  readonly entries: readonly UraEntry[];
  readonly verdict: UraArtifactVerdict;
}

/** Why an artifact couldn't be compiled. */
export type UraArtifactError =
  | { readonly kind: 'foreign-item'; readonly itemId: string }
  | { readonly kind: 'approve-over-blocking'; readonly itemIds: readonly string[] };
