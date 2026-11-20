import type { UraSeverityView } from '#contract/ipc-contract.ts';

/** What the notes list's selected notes are, for the Note commands' names (ADR 0144). */
export interface NoteListSelectionFacts {
  readonly count: number;
  /** Every one of them is addressed: Mark as Not Addressed. */
  readonly isAddressed: boolean;
  /** Every one of them is withdrawn: Restore. */
  readonly isWithdrawn: boolean;
  /** Every one of them blocks the merge: Mark as Not Blocking. */
  readonly isBlocking: boolean;
  /** The status every one of them has, which Status checks (ADR 0150); absent when they differ. */
  readonly status?: 'staged' | 'withdrawn' | 'addressed';
  /** The label every one of them has, which Label checks (ADR 0150); absent when they differ. */
  readonly severity?: UraSeverityView;
}
