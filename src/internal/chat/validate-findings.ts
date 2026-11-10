import type { ChatQuestion } from './chat-question.ts';
import type { ChatReview } from './chat-review.ts';
import { DiffHunkIndex } from './diff-hunk-index.ts';
import type { ModelFinding } from './finding-output-schema.ts';
import type { FindingSeverity } from './finding-severities.ts';

export interface FindingLimits {
  readonly maxFindings: number;
  /** Findings the model rated below this are dropped. */
  readonly minConfidence: number;
}

/** How many model findings were dropped, by reason; the verification pass adds `unconfirmed`. */
export type FindingDrops = Omit<ChatReview['dropped'], 'unconfirmed'>;

export interface ValidatedFindings {
  /** In diff file order, then by line. */
  readonly findings: readonly ModelFinding[];
  readonly dropped: FindingDrops;
  /** Kept findings whose line range was narrowed to the hunks it touches. */
  readonly clamped: number;
}

/**
 * Keeps only findings a reviewer can act on in the diff they're shown (ADR 0019, 0055): each must
 * name a head-side
 * text file of the diff (paths are normalized from `./x` or an absolute worktree path) and touch
 * one of its hunks; its range is narrowed to the touched hunks. Text is trimmed, titles made one
 * line, duplicates and low-confidence findings dropped, and the rest ranked (severity, then
 * confidence) and capped. Pure and deterministic.
 */
export function validateFindings(
  raw: readonly ModelFinding[],
  input: Pick<ChatQuestion, 'files' | 'worktreePath'>,
  limits: FindingLimits,
): ValidatedFindings {
  const hunks = new DiffHunkIndex(input);

  const drops = { unknownFile: 0, outsideDiff: 0, lowConfidence: 0, duplicate: 0, overLimit: 0 };
  let clamped = 0;
  const seen = new Set<string>();
  const candidates: { finding: ModelFinding; order: number; index: number }[] = [];
  for (const [index, finding] of raw.entries()) {
    const range = hunks.anchor(finding);
    if (range.kind === 'unknown-file') {
      drops.unknownFile += 1;
      continue;
    }
    if (range.kind === 'outside-diff') {
      drops.outsideDiff += 1;
      continue;
    }
    const confidence = Math.min(Math.max(finding.confidence, 0), 1);
    if (confidence < limits.minConfidence) {
      drops.lowConfidence += 1;
      continue;
    }
    const title = finding.title.replaceAll(whitespace, ' ').trim().slice(0, 200);
    const key = `${range.path}\0${String(range.startLine)}\0${String(range.endLine)}\0${title.toLowerCase()}`;
    if (seen.has(key)) {
      drops.duplicate += 1;
      continue;
    }
    seen.add(key);
    if (range.isClamped) {
      clamped += 1;
    }
    candidates.push({
      finding: {
        ...finding,
        path: range.path,
        startLine: range.startLine,
        endLine: range.endLine,
        title,
        body: finding.body.trim(),
        confidence,
      },
      order: range.order,
      index,
    });
  }

  const ranked = candidates.toSorted((a, b) => {
    return (
      severityRank(b.finding.severity) - severityRank(a.finding.severity) ||
      b.finding.confidence - a.finding.confidence ||
      a.index - b.index
    );
  });
  const kept = ranked.slice(0, Math.max(0, limits.maxFindings));
  drops.overLimit = ranked.length - kept.length;
  const findings = kept
    .toSorted((a, b) => {
      return (
        a.order - b.order ||
        a.finding.startLine - b.finding.startLine ||
        a.finding.endLine - b.finding.endLine ||
        a.index - b.index
      );
    })
    .map((candidate) => candidate.finding);
  return { findings, dropped: drops, clamped };
}

const whitespace = /\s+/gu;
function severityRank(severity: FindingSeverity): number {
  switch (severity) {
    case 'info': {
      return 0;
    }
    case 'warning': {
      return 1;
    }
    case 'risk': {
      return 2;
    }
  }
}
