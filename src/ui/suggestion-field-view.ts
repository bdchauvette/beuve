/**
 * One suggestion field of a note being composed or edited (ADR 0162): which lines of which head it
 * replaces, and what it starts from. Fields are uncontrolled: the text typed lives in the field's
 * editor until the note is saved.
 */
export interface SuggestionFieldView {
  /** Unique among a form's fields, so a list keeps each field's editor. */
  readonly key: string;
  /** The stored suggestion this field edits, sent back on save to keep its identity; absent for a new one. */
  readonly id?: string;
  /** The head the lines are on: the note's `headSha`. */
  readonly headSha: string;
  readonly path: string;
  /** 1-based and inclusive; `endLine` is `startLine - 1` for an insertion before `startLine`. */
  readonly startLine: number;
  readonly endLine: number;
  /** The text the field starts from; absent to start from the head's current text of the lines. */
  readonly replacement?: string;
  /** Why a stored suggestion no longer maps onto the session's head, to show beside it. */
  readonly outdated?: string;
}

/** The lines a suggestion field is over. */
export type SuggestionLines = Pick<SuggestionFieldView, 'path' | 'startLine' | 'endLine'>;
