import type { Brand } from '#x/brand/brand.ts';

import type { InsightCategory } from './insight-categories.ts';
import type { InsightSeverity } from './insight-severities.ts';
import type { InsightStatus } from './insight-statuses.ts';

/** An agent insight's id (a UUID). */
export type AgentInsightId = Brand<string, 'AgentInsightId'>;

/** A review run's id (a UUID). */
export type ReviewRunId = Brand<string, 'ReviewRunId'>;

/**
 * A review session's id. Structurally identical to the session domain's `SessionId`, so main
 * passes one for the other without either domain importing the other (ADR 0009).
 */
export type SessionId = Brand<string, 'SessionId'>;

/** A full, lowercase commit id; structurally identical to the git and session domains' brand. */
export type CommitSha = Brand<string, 'CommitSha'>;

/**
 * One non-blocking observation from the preliminary agentic review (spec 5B). Lines are 1-based
 * and inclusive on the head side of the reviewed diff, and always intersect one of its hunks.
 */
export interface AgentInsight {
  readonly id: AgentInsightId;
  readonly runId: ReviewRunId;
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  readonly path: string;
  readonly side: 'head';
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly severity: InsightSeverity;
  readonly category: InsightCategory;
  readonly title: string;
  /** Markdown. */
  readonly body: string;
  /** 0–1, as the model calibrated it. */
  readonly confidence: number;
  readonly status: InsightStatus;
  /** The model that produced it (from its {@link ReviewRun}). */
  readonly model: string;
  readonly createdAt: string;
}

/**
 * One completed preliminary review of a session at a head, limited to a path scope. At most one
 * per (session, head, path scope): main checks {@link findReviewRun} before scheduling and
 * {@link insertReviewRun} enforces it (ADR 0024).
 */
export interface ReviewRun {
  readonly id: ReviewRunId;
  readonly sessionId: SessionId;
  readonly scope: 'full' | 'interdiff';
  /**
   * The normalized, sorted path prefixes the run was limited to (`normalizePathScope`); `[]` is
   * the whole change. Part of the run's identity.
   */
  readonly pathScope: readonly string[];
  /** The fork point (merge-base) the reviewed diff was taken against. */
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
  /** For interdiffs, the previously reviewed head; otherwise `undefined`. */
  readonly fromHeadSha: CommitSha | undefined;
  readonly model: string;
  readonly insightCount: number;
  /** Insights the model returned that validation dropped. */
  readonly droppedCount: number;
  readonly createdAt: string;
}

/** Expected failures of the review domain's persistence. */
export type ReviewStoreError =
  | { readonly kind: 'session-not-found'; readonly sessionId: SessionId }
  | {
      readonly kind: 'duplicate-run';
      readonly sessionId: SessionId;
      readonly headSha: CommitSha;
      readonly pathScope: readonly string[];
    }
  | { readonly kind: 'insight-not-found'; readonly id: AgentInsightId }
  | {
      readonly kind: 'corrupt-row';
      readonly table: 'review_runs' | 'agent_insights';
      readonly id: string;
      readonly reason: string;
    };
