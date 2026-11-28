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
  /** The suggestions the draft carries so far, in the form's order; the prompt names them s1, s2, …. */
  readonly suggestions: readonly NoteDraftSuggestion[];
}

/**
 * One suggestion of a draft (ADR 0162): the head lines it replaces and the text it puts there.
 * `headText` is those lines' text at the note's head, read by main since domains read no files;
 * absent when it couldn't be read.
 */
export interface NoteDraftSuggestion {
  readonly path: string;
  /** 1-based and inclusive; `endLine = startLine - 1` is an insertion before `startLine`. */
  readonly startLine: number;
  readonly endLine: number;
  readonly replacement: string;
  readonly headText?: string | undefined;
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
