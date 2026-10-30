import { parseMarkdownSubset } from './parse-markdown-subset.ts';
import type { InlineSpan } from './parse-markdown-subset.ts';

/**
 * The inline spans of a one-line title written by a person or a model (inline code, bold, italics,
 * link text), for a renderer that builds text nodes. Block syntax in a title is flattened to its
 * text, so a title never becomes a list or a heading.
 */
export function parseInlineTitle(title: string): InlineSpan[] {
  return parseMarkdownSubset(title.replaceAll(/\s+/gu, ' ').trim()).flatMap((block) => {
    switch (block.kind) {
      case 'paragraph': {
        return block.spans;
      }
      case 'list': {
        return block.items.flat();
      }
      case 'code': {
        return [{ kind: 'text', text: block.text } as const];
      }
    }
  });
}
