/**
 * A review note the reviewer is drafting (ADR 0125), declared here because domains can't import
 * the ura domain's types: main maps the renderer's request into it.
 */
export interface NoteDraft {
  readonly severity: NoteSeverity;
  /** Whether the note blocks the merge (ADR 0131's decoration). */
  readonly blocking: boolean;
  /** The one-line title; empty when the reviewer left it out. */
  readonly title: string;
  /** The Markdown body as written so far; may be empty. */
  readonly body: string;
  readonly anchor: NoteAnchor;
}

/** The note's Conventional Comments label, or beuve's `smell` (ADR 0131). */
export type NoteSeverity =
  | 'issue'
  | 'suggestion'
  | 'question'
  | 'nitpick'
  | 'thought'
  | 'smell'
  | 'praise'
  | 'note'
  | 'todo'
  | 'chore';

/** Where a note points on its head: lines are 1-based and inclusive, on the head side. */
export type NoteAnchor =
  | {
      readonly kind: 'lines';
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'change' };
