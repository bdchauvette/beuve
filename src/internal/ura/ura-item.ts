import type { Brand } from '#x/brand/brand.ts';

import type { UraSeverity } from './ura-severities.ts';

/** A URA item's id (a UUID). */
export type UraItemId = Brand<string, 'UraItemId'>;

/**
 * A suggestion's id (a UUID), unique within its item and kept across edits, so a posting names the
 * same suggestion however the list around it changes (ADR 0162).
 */
export type UraSuggestionId = Brand<string, 'UraSuggestionId'>;

/**
 * A review session's id. Structurally identical to the session domain's `SessionId`, so main
 * passes one for the other without either domain importing the other (ADR 0009).
 */
export type SessionId = Brand<string, 'SessionId'>;

/** A full, lowercase commit id; structurally identical to the git and session domains' brand. */
export type CommitSha = Brand<string, 'CommitSha'>;

/**
 * Where an item points, on the head side of the head it was written against. Lines are 1-based
 * and inclusive. Paths are repository-relative with `/` separators.
 */
export type UraAnchor =
  | {
      readonly kind: 'lines';
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'change' };

/**
 * Who or what raised an item. A `chat-answer` item stages a chat answer, or with `finding` the
 * n-th (0-based) finding of a `/review` answer (ADR 0055), or with `proposal` the n-th (0-based)
 * note an answer proposed (ADR 0132); never both. A finding keeps its `confidence` (ADR 0143).
 */
export type UraOrigin =
  | { readonly kind: 'human' }
  | {
      readonly kind: 'chat-answer';
      readonly messageId: string;
      readonly finding?: number;
      readonly proposal?: number;
      /**
       * Only with `finding`: the model's own 0–1 estimate that a careful reviewer would agree it is
       * a real problem. Absent on findings staged before beuve kept it.
       */
      readonly confidence?: number;
    };

/**
 * `staged` items are exported. `addressed` records the later head at which a reviewer or an agent
 * judged the issue fixed; `withdrawn` items were dropped. Each status is reached by its own action,
 * from either of the others (ADR 0151).
 */
export type UraStatus =
  | { readonly kind: 'staged' }
  | { readonly kind: 'withdrawn' }
  | {
      readonly kind: 'addressed';
      readonly atSha: CommitSha;
      readonly by: 'reviewer' | 'agent';
    };

/**
 * What a suggestion replaces and with what (ADR 0162), on the head side of its item's `headSha`,
 * on any path of that head's tree. Lines are 1-based and inclusive; `endLine` is `startLine - 1`
 * for an insertion before `startLine` (after the last line when `startLine` is one past it).
 * `replacement` is the new lines, `\n`-joined, without a final newline: `''` is no lines, so a
 * suggestion with it deletes its lines.
 */
export interface UraSuggestionRange {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly replacement: string;
}

/** A replacement of head lines a note suggests, with its id. */
export interface UraSuggestion extends UraSuggestionRange {
  readonly id: UraSuggestionId;
}

/**
 * A suggestion as a caller supplies it: with the id of one the item already has to keep that
 * suggestion's identity, or without one for a new suggestion (`uraSuggestionsFromDrafts`).
 */
export interface UraSuggestionDraft extends UraSuggestionRange {
  readonly id?: string;
}

/** One line of a suggested patch's hunk, without its prefix. */
export interface PatchLine {
  readonly kind: 'context' | 'added' | 'removed';
  readonly content: string;
}

export interface PatchHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly PatchLine[];
}

/**
 * A unified diff that touches only one path (and, checked against a line anchor, only the
 * anchored lines). Built by `parseSuggestedPatch`; nothing stores one (ADR 0162). `text` is normalized: `--- a/` and
 * `+++ b/` headers for `path`, then the hunks, newline-terminated.
 */
export interface SuggestedPatch {
  readonly path: string;
  readonly text: string;
  readonly hunks: readonly PatchHunk[];
}

/**
 * One reviewer decision in the notes list (spec Zone 3). Timestamps are ISO-8601 UTC.
 * `headSha`, `anchor` and `origin` never change; re-anchoring to a later head is computed at
 * export time (`reanchorUraAnchor`).
 */
export interface UraItem {
  readonly id: UraItemId;
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  readonly anchor: UraAnchor;
  readonly severity: UraSeverity;
  /** The Conventional Comments `(blocking)` decoration: the note must be resolved before merging. */
  readonly blocking: boolean;
  readonly origin: UraOrigin;
  /** One line, at most 200 characters. */
  readonly title: string;
  /** Markdown; may be empty. */
  readonly body: string;
  /** In the order they were added, never overlapping; at most 500 (`validateUraItem`). */
  readonly suggestions: readonly UraSuggestion[];
  readonly status: UraStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What a note is (its label) and whether it blocks; the verdict is derived from these. */
export type UraItemLabel = Pick<UraItem, 'severity' | 'blocking'>;

/** Effects the constructors need, injected for determinism. Time is not injected (ADR 0059). */
export interface UraDeps {
  readonly newId: () => string;
}

/** Why an item, or a change to one, was refused. */
export type UraItemError =
  | { readonly kind: 'invalid-anchor'; readonly reason: string }
  | { readonly kind: 'invalid-origin'; readonly reason: string }
  | { readonly kind: 'invalid-text'; readonly reason: string }
  | { readonly kind: 'invalid-patch'; readonly reason: string }
  | { readonly kind: 'invalid-suggestion'; readonly reason: string }
  | {
      readonly kind: 'invalid-transition';
      readonly from: UraStatus['kind'];
      readonly to: UraStatus['kind'];
      readonly reason: string;
    };

/** Expected failures of the URA domain's persistence. */
export type UraStoreError =
  | { readonly kind: 'session-not-found'; readonly sessionId: SessionId }
  | { readonly kind: 'item-not-found'; readonly id: UraItemId }
  | {
      readonly kind: 'duplicate-item';
      readonly id: UraItemId;
      readonly reason: 'id-taken' | 'origin-already-staged';
    }
  | { readonly kind: 'order-mismatch'; readonly sessionId: SessionId }
  | {
      readonly kind: 'corrupt-row';
      readonly table: 'ura_items' | 'ura_item_suggestions';
      readonly id: string;
      readonly reason: string;
    };
