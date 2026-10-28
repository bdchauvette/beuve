import type { Brand } from '#pkg/brand/brand.ts';

import type { UraSeverity } from './ura-severities.ts';

/** A URA item's id (a UUID). */
export type UraItemId = Brand<string, 'UraItemId'>;

/**
 * A review session's id. Structurally identical to the session domain's `SessionId`, so main
 * passes one for the other without either domain importing the other (ADR 0009).
 */
export type SessionId = Brand<string, 'SessionId'>;

/** A full, lowercase commit id; structurally identical to the git and session domains' brand. */
export type CommitSha = Brand<string, 'CommitSha'>;

/** An agent insight's id; structurally identical to the review domain's brand. */
export type AgentInsightId = Brand<string, 'AgentInsightId'>;

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

/** The ImpactGate metrics an item can carry (ADR 0015). */
export type ImpactMetric = 'cognitive-complexity';

/** Who or what raised an item. Agent and ImpactGate items keep the facts they came from. */
export type UraOrigin =
  | { readonly kind: 'human' }
  | { readonly kind: 'agent-insight'; readonly insightId: AgentInsightId }
  | {
      readonly kind: 'impact-finding';
      readonly metric: ImpactMetric;
      readonly functionName: string;
      readonly value: number;
      readonly threshold: number;
      /** 0–100, as ImpactGate ranked the function in its review. */
      readonly percentile: number;
    }
  | { readonly kind: 'chat-answer'; readonly messageId: string };

/**
 * `staged` items are exported. `addressed` records the later head at which a reviewer or an agent
 * judged the issue fixed; `withdrawn` items were dropped. Both can be restored to `staged`.
 */
export type UraStatus =
  | { readonly kind: 'staged' }
  | { readonly kind: 'withdrawn' }
  | {
      readonly kind: 'addressed';
      readonly atSha: CommitSha;
      readonly by: 'reviewer' | 'agent';
    };

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
 * A unified diff that touches only its item's anchored path (and, for a line anchor, only the
 * anchored lines). Built by `parseSuggestedPatch`. `text` is normalized: `--- a/` and
 * `+++ b/` headers for `path`, then the hunks, newline-terminated.
 */
export interface SuggestedPatch {
  readonly path: string;
  readonly text: string;
  readonly hunks: readonly PatchHunk[];
}

/**
 * One reviewer decision in the URA staging dock (spec Zone 3). Timestamps are ISO-8601 UTC.
 * `headSha`, `anchor` and `origin` never change; re-anchoring to a later head is computed at
 * export time (`reanchorUraAnchor`).
 */
export interface UraItem {
  readonly id: UraItemId;
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  readonly anchor: UraAnchor;
  readonly severity: UraSeverity;
  readonly origin: UraOrigin;
  /** One line, at most 200 characters. */
  readonly title: string;
  /** Markdown; may be empty. */
  readonly body: string;
  readonly suggestion: SuggestedPatch | undefined;
  readonly status: UraStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Effects the pure constructors need, injected for determinism. */
export interface UraDeps {
  readonly now: () => Date;
  readonly newId: () => string;
}

/** Why an item, or a change to one, was refused. */
export type UraItemError =
  | { readonly kind: 'invalid-anchor'; readonly reason: string }
  | { readonly kind: 'invalid-origin'; readonly reason: string }
  | { readonly kind: 'invalid-text'; readonly reason: string }
  | { readonly kind: 'invalid-patch'; readonly reason: string }
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
      readonly reason: 'id-taken' | 'insight-already-staged' | 'finding-already-staged';
    }
  | { readonly kind: 'order-mismatch'; readonly sessionId: SessionId }
  | {
      readonly kind: 'corrupt-row';
      readonly table: 'ura_items';
      readonly id: string;
      readonly reason: string;
    };
