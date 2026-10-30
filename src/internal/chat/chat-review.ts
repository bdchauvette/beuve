import type { FindingCategory } from './finding-categories.ts';
import type { FindingSeverity } from './finding-severities.ts';

/**
 * One finding of a `/review` answer (ADR 0055). Lines are 1-based and inclusive on the head side,
 * and always touch a hunk of the reviewed diff.
 */
export interface ChatFinding {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  /** One line, at most 200 characters. */
  readonly title: string;
  /** Markdown from the model; untrusted. */
  readonly body: string;
  /** 0–1, as the model calibrated it. */
  readonly confidence: number;
  /**
   * What the verification pass said: `confirmed` by the code at the cited lines, `unconfirmed`
   * when it could neither confirm nor refute it, `unchecked` when no pass ran (`--no-verify`, or
   * it failed). Refuted findings are dropped, not kept.
   */
  readonly check: 'confirmed' | 'unconfirmed' | 'unchecked';
}

/** Findings the model returned that a `/review` answer left out, by reason. */
export interface ReviewDrops {
  /** Not a head-side text file of the reviewed diff. */
  readonly unknownFile: number;
  /** In a diff file but outside every hunk. */
  readonly outsideDiff: number;
  readonly lowConfidence: number;
  readonly duplicate: number;
  /** Beyond the limit, after ranking by severity and confidence. */
  readonly overLimit: number;
  /** Refuted by the verification pass. */
  readonly unconfirmed: number;
}

/** The structured part of a completed `/review` answer (ADR 0055), stored with the message. */
export interface ChatReview {
  /** In diff file order, then by line. */
  readonly findings: readonly ChatFinding[];
  readonly dropped: ReviewDrops;
  /** The normalized path prefixes the review was limited to; `[]` is the whole change. */
  readonly pathScope: readonly string[];
  /** Files sent to the model. */
  readonly fileCount: number;
  /** `verified`: the second pass ran; `skipped`: `--no-verify` or nothing to verify; `failed`. */
  readonly verification: 'verified' | 'skipped' | 'failed';
  /** The earlier answer at the same head and scope this one repeats (no `--fresh`). */
  readonly reusedFrom?: string;
}
