import { countUraSeverities } from './count-ura-severities.ts';
import type { OutdatedReason, UraArtifact, UraEntry, UraVerdict } from './ura-artifact.ts';
import type { UraAnchor, UraOrigin } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';

/** Identifies the schema of {@link AgentReview} and its XML form. */
export type AgentReviewSchema = 'beuve.ura/1';

/** A location on the head side: lines are 1-based and inclusive. */
export type AgentReviewAnchor =
  | {
      readonly kind: 'lines';
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'change' };

export type AgentReviewOrigin =
  | { readonly kind: 'human' }
  | {
      readonly kind: 'impact-finding';
      readonly metric: string;
      readonly functionName: string;
      readonly value: number;
      readonly threshold: number;
      readonly percentile: number;
    }
  | { readonly kind: 'chat-answer'; readonly messageId: string; readonly finding?: number };

export interface AgentReviewItem {
  readonly id: string;
  readonly severity: UraSeverity;
  readonly origin: AgentReviewOrigin;
  /** Where the item applies on `change.headSha`; absent when it is outdated. */
  readonly anchor?: AgentReviewAnchor;
  /** Present when the item no longer maps onto the head; its patch then refers to the older head. */
  readonly outdated?: {
    readonly reason: OutdatedReason;
    readonly writtenAgainstSha: string;
    readonly originalAnchor: AgentReviewAnchor;
  };
  readonly title: string;
  /** Markdown. */
  readonly body: string;
  /** A unified diff for the anchored path, against the head the item was written against. */
  readonly suggestedPatch?: string;
}

/**
 * The structured review an agent acts on (and the MCP tool `beuve_read_human_review` returns):
 * plain JSON data, no instructions; optional keys are omitted rather than `null`. Items are in the reviewer's order.
 */
export interface AgentReview {
  readonly schema: AgentReviewSchema;
  readonly change: {
    readonly repository:
      | {
          readonly kind: 'local';
          readonly path: string;
          readonly baseRef: string;
          readonly headRef: string;
        }
      | {
          readonly kind: 'github-pull-request';
          readonly path: string;
          readonly baseRef: string;
          readonly owner: string;
          readonly repo: string;
          readonly number: number;
        };
    readonly scope: 'full' | 'interdiff';
    /** The fork point the review was diffed against. */
    readonly baseSha: string;
    readonly headSha: string;
    /** For interdiffs, the previously reviewed head. */
    readonly fromHeadSha?: string;
  };
  readonly verdict: UraVerdict;
  readonly verdictSource: 'derived' | 'chosen';
  readonly counts: Readonly<Record<UraSeverity, number>>;
  readonly items: readonly AgentReviewItem[];
}

/** The JSON form of an artifact for agents. Pure and deterministic. */
export function buildAgentReview(artifact: UraArtifact): AgentReview {
  const { summary } = artifact;
  const { change } = summary;
  return {
    schema: 'beuve.ura/1',
    change: {
      repository:
        change.kind === 'local'
          ? {
              kind: 'local',
              path: change.repoPath,
              baseRef: change.baseRef,
              headRef: change.headRef,
            }
          : {
              kind: 'github-pull-request',
              path: change.repoPath,
              baseRef: change.baseRef,
              owner: change.owner,
              repo: change.repo,
              number: change.number,
            },
      scope: summary.scope.kind,
      baseSha: summary.baseSha,
      headSha: summary.headSha,
      ...(summary.scope.kind === 'interdiff' && { fromHeadSha: summary.scope.fromHeadSha }),
    },
    verdict: artifact.verdict.value,
    verdictSource: artifact.verdict.source,
    counts: countUraSeverities(artifact.entries),
    items: artifact.entries.map((entry) => toItem(entry)),
  };
}

function toItem({ item, placement }: UraEntry): AgentReviewItem {
  return {
    id: item.id,
    severity: item.severity,
    origin: toOrigin(item.origin),
    ...(placement.kind === 'current'
      ? { anchor: toAnchor(placement.anchor) }
      : {
          outdated: {
            reason: placement.reason,
            writtenAgainstSha: item.headSha,
            originalAnchor: toAnchor(item.anchor),
          },
        }),
    title: item.title,
    body: item.body,
    ...(item.suggestion !== undefined && { suggestedPatch: item.suggestion.text }),
  };
}

function toAnchor(anchor: UraAnchor): AgentReviewAnchor {
  switch (anchor.kind) {
    case 'lines': {
      const { path, startLine, endLine } = anchor;
      return { kind: 'lines', path, startLine, endLine };
    }
    case 'file': {
      return { kind: 'file', path: anchor.path };
    }
    case 'change': {
      return { kind: 'change' };
    }
  }
}

function toOrigin(origin: UraOrigin): AgentReviewOrigin {
  switch (origin.kind) {
    case 'human': {
      return { kind: 'human' };
    }
    case 'impact-finding': {
      const { metric, functionName, value, threshold, percentile } = origin;
      return { kind: 'impact-finding', metric, functionName, value, threshold, percentile };
    }
    case 'chat-answer': {
      return {
        kind: 'chat-answer',
        messageId: origin.messageId,
        ...(origin.finding !== undefined && { finding: origin.finding }),
      };
    }
  }
}
