/** How a table column aligns its cells; `undefined` is the default (start). */
export type TableAlignment = 'left' | 'center' | 'right' | undefined;

/**
 * An inline node of untrusted Markdown (ADR 0073). Text is always text: nothing here is ever
 * HTML, and a link's `href` is already a safe `http(s)` URL.
 */
export type MarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'emphasis'; readonly children: readonly MarkdownInline[] }
  | {
      readonly kind: 'link';
      readonly href: string;
      readonly children: readonly MarkdownInline[];
    }
  /** A `[[…]]` line citation as written; the renderer decides whether it is a pill (ADR 0031). */
  | { readonly kind: 'marker'; readonly text: string };

/** A block of the supported Markdown subset (ADR 0073). */
export type MarkdownBlock =
  | { readonly kind: 'paragraph'; readonly children: readonly MarkdownInline[] }
  | {
      readonly kind: 'heading';
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly children: readonly MarkdownInline[];
    }
  /** A fenced block; `closed` is false while (or if) its closing fence never came. */
  | {
      readonly kind: 'code';
      readonly info: string;
      readonly text: string;
      readonly closed: boolean;
    }
  | {
      readonly kind: 'list';
      /** The first number of an ordered list; absent for a bullet list. */
      readonly start?: number;
      readonly items: readonly (readonly MarkdownBlock[])[];
    }
  | { readonly kind: 'quote'; readonly children: readonly MarkdownBlock[] }
  | { readonly kind: 'rule' }
  | {
      readonly kind: 'table';
      readonly alignments: readonly TableAlignment[];
      readonly head: readonly (readonly MarkdownInline[])[];
      readonly rows: readonly (readonly (readonly MarkdownInline[])[])[];
    };
