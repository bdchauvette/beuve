/** What the dock's selected notes are, for the Note commands' names (ADR 0142). */
export interface DockSelectionFacts {
  readonly count: number;
  /** Every one of them is addressed: Mark as Not Addressed. */
  readonly isAddressed: boolean;
  /** Every one of them is withdrawn: Restore. */
  readonly isWithdrawn: boolean;
  /** Every one of them blocks the merge: Mark as Not Blocking. */
  readonly isBlocking: boolean;
}
