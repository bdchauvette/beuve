/**
 * A review note the model proposed in an ordinary answer (ADR 0132), for the reviewer to stage
 * with one click. Lines are 1-based and inclusive on the head side, and touch a hunk of the
 * reviewed diff. `label` is one of the note labels main offered when the question was asked.
 */
export interface NoteProposal {
  /** Repository-relative, `/`-separated. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly label: string;
  /** One line, at most 200 characters; may be empty when the body says it all. */
  readonly title: string;
  /** Markdown from the model; untrusted. */
  readonly body: string;
}

/**
 * Why a proposed note was left out: its block did not parse or said nothing (`malformed`), its
 * label is not a note label, its lines are not in a head-side text file of the diff or outside
 * every hunk, it repeats an earlier one, or it is beyond the per-answer limit.
 */
export type ProposalDropReason =
  'malformed' | 'unknown-label' | 'unknown-file' | 'outside-diff' | 'duplicate' | 'over-limit';

/** What main offers the model for proposing notes (ADR 0132). */
export interface ProposalRules {
  /** The labels a note may carry, most urgent first: the URA's, which main passes in. */
  readonly labels: readonly string[];
  /** Proposals beyond this many in one answer are dropped. */
  readonly maxProposals: number;
}

/** One piece of a validated answer, in order: Markdown, a kept proposal, or a dropped one. */
export type AnswerPiece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'proposal'; readonly proposal: NoteProposal }
  | { readonly kind: 'dropped-proposal'; readonly reason: ProposalDropReason };
