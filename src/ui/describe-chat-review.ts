import type { ChatFindingView, ChatReviewView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';

/** How the transcript labels a `/review` answer (ADR 0055). */
export interface ChatReviewLabels {
  /** "2 files · 1 finding · 1 dropped as unconfirmed · 2 off the diff". */
  readonly summary: string;
  /** A second line when the answer repeats an earlier one, or the check did not run. */
  readonly note?: string;
  readonly findings: readonly FindingLabels[];
}

export interface FindingLabels {
  readonly severity: 'Risk' | 'Warning' | 'Info';
  /** "edge case", "error handling"… */
  readonly category: string;
  /** "80%". */
  readonly confidence: string;
  /** "confirmed", "unconfirmed" or "unchecked", with what it means as `checkTitle`. */
  readonly check: ChatFindingView['check'];
  readonly checkTitle: string;
  /** `path:start-end`, or `path:line` for one line. */
  readonly where: string;
}

const severities: Readonly<Record<ChatFindingView['severity'], FindingLabels['severity']>> = {
  risk: 'Risk',
  warning: 'Warning',
  info: 'Info',
};

const checkTitles: Readonly<Record<ChatFindingView['check'], string>> = {
  confirmed: 'A second pass read the code at these lines and confirmed it',
  unconfirmed: 'A second pass read the code but could neither confirm nor refute it',
  unchecked: 'Not checked against the code',
};

/**
 * Labels for a `/review` answer: one calm summary line (files, findings, what was dropped and
 * why) and per-finding severity, category, confidence and verification. Pure.
 */
export function describeChatReview(review: ChatReviewView): ChatReviewLabels {
  const { dropped } = review;
  const offDiff = dropped.outsideDiff + dropped.unknownFile;
  const weak = dropped.lowConfidence + dropped.duplicate + dropped.overLimit;
  const parts = [countNoun(review.fileCount, 'file'), countNoun(review.findings.length, 'finding')];
  if (dropped.unconfirmed > 0) {
    parts.push(`${String(dropped.unconfirmed)} dropped as unconfirmed`);
  }
  if (offDiff > 0) {
    parts.push(`${String(offDiff)} off the diff`);
  }
  if (weak > 0) {
    parts.push(`${String(weak)} below the bar`);
  }
  const note = reviewNote(review);
  return {
    summary: parts.join(' · '),
    ...(note !== undefined && { note }),
    findings: review.findings.map((finding) => {
      return {
        severity: severities[finding.severity],
        category: finding.category.replaceAll('-', ' '),
        confidence: `${String(Math.round(finding.confidence * 100))}%`,
        check: finding.check,
        checkTitle: checkTitles[finding.check],
        where: whereOf(finding),
      };
    }),
  };
}

function reviewNote(review: ChatReviewView): string | undefined {
  if (review.reusedFrom !== undefined) {
    return 'Repeated from the earlier review of this head; /review --fresh reruns it.';
  }
  if (review.verification === 'failed') {
    return 'The verification pass did not finish; findings are unchecked.';
  }
  return undefined;
}

/** `path:12`, or `path:12-15` for a range. */
function whereOf(finding: ChatFindingView): string {
  if (finding.startLine === finding.endLine) {
    return `${finding.path}:${String(finding.startLine)}`;
  }
  return `${finding.path}:${String(finding.startLine)}-${String(finding.endLine)}`;
}
