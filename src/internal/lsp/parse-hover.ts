import { isLspRange } from './is-lsp-range.ts';
import type { LspHover, LspRange } from './lsp-protocol.ts';

/** Longest hover text kept, in UTF-16 code units; a longer one is cut and marked. */
const maxHoverLength = 16_384;

/**
 * Parses a `textDocument/hover` result: `null` or an empty `contents` is `undefined`. `contents` is
 * a `MarkupContent`, a `MarkedString` or an array of them; all become Markdown, parts separated by
 * a rule. Malformed parts are dropped, and a `range` that isn't one is ignored.
 */
export function parseHover(value: unknown): LspHover | undefined {
  if (typeof value !== 'object' || value === null || !('contents' in value)) {
    return undefined;
  }
  const parts: unknown[] = [value.contents].flat();
  const sections = parts.flatMap((part: unknown) => {
    const markdown = markdownFrom(part);
    if (markdown === undefined || markdown.trim() === '') {
      return [];
    }
    return markdown.trim();
  });
  if (sections.length === 0) {
    return undefined;
  }
  let range: LspRange | undefined;
  if ('range' in value && isLspRange(value.range)) {
    range = value.range;
  }
  return { markdown: truncated(sections.join('\n\n---\n\n')), range };
}

function markdownFrom(part: unknown): string | undefined {
  if (typeof part === 'string') {
    return part;
  }
  if (typeof part !== 'object' || part === null || !('value' in part)) {
    return undefined;
  }
  const { value } = part;
  if (typeof value !== 'string') {
    return undefined;
  }
  if ('kind' in part) {
    if (part.kind === 'markdown') {
      return value;
    }
    if (part.kind === 'plaintext') {
      return fenced({ text: value, language: '' });
    }
    return undefined;
  }
  if ('language' in part && typeof part.language === 'string') {
    return fenced({ text: value, language: part.language.replaceAll(/[^\w+#.-]/gu, '') });
  }
  return undefined;
}

interface FencedCode {
  readonly text: string;
  readonly language: string;
}

/** A code block whose fence is longer than any run of backticks in `text`. */
function fenced({ text, language }: FencedCode): string {
  let longest = 0;
  for (const run of text.matchAll(/`+/gu)) {
    longest = Math.max(longest, run[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function truncated(text: string): string {
  if (text.length <= maxHoverLength) {
    return text;
  }
  let cut = text.slice(0, maxHoverLength);
  if (!cut.isWellFormed()) {
    cut = cut.slice(0, -1);
  }
  return `${cut}\n\n…`;
}
