import type { UraSeverityView } from '#contract/ipc-contract.ts';

/** What the label menu needs of a note. */
export interface LabeledNote {
  readonly severity: UraSeverityView;
  readonly blocking: boolean;
}

/**
 * The label and Blocking a set of notes shares, for the dock's selection bar (ADR 0144): `mixed`
 * where the notes differ. No notes read as a new note's (`issue`, not blocking).
 */
export interface NoteLabelState {
  readonly severity: UraSeverityView | 'mixed';
  readonly blocking: boolean | 'mixed';
}

/** The label state the notes share, `mixed` for each part they disagree on. */
export function noteLabelStateFrom(notes: readonly LabeledNote[]): NoteLabelState {
  const [first] = notes;
  if (first === undefined) {
    return { severity: 'issue', blocking: false };
  }
  let severity: NoteLabelState['severity'] = first.severity;
  if (notes.some((note) => note.severity !== first.severity)) {
    severity = 'mixed';
  }
  let blocking: NoteLabelState['blocking'] = first.blocking;
  if (notes.some((note) => note.blocking !== first.blocking)) {
    blocking = 'mixed';
  }
  return { severity, blocking };
}
