/**
 * A review note the reviewer is drafting (ADR 0125), declared here because domains can't import
 * the ura domain's types: main maps the renderer's request into it.
 */
export interface NoteDraft {
  readonly severity: NoteSeverity;
  /** The one-line title; empty when the reviewer left it out. */
  readonly title: string;
  /** The Markdown body as written so far; may be empty. */
  readonly body: string;
  readonly anchor: NoteAnchor;
}

/** How much a note matters, most urgent first (ADR 0023). */
export type NoteSeverity = 'blocker' | 'issue' | 'question' | 'nit' | 'praise';

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
