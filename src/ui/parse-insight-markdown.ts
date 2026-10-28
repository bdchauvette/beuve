/** A run of inline text; rendered as text nodes, never as HTML. */
export interface InlineSpan {
  readonly kind: 'text' | 'code' | 'strong' | 'emphasis';
  readonly text: string;
}

export type MarkdownBlock =
  | { readonly kind: 'paragraph'; readonly spans: readonly InlineSpan[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly InlineSpan[])[] }
  | { readonly kind: 'code'; readonly text: string };

const fence = /^\s*(```|~~~)/u;
const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/u;
const heading = /^\s*#{1,6}\s+(.*)$/u;
const inline =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\([^)]*\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/gu;

/**
 * A tiny, safe Markdown subset for agent insight bodies (untrusted model output): paragraphs,
 * bullet and numbered lists, fenced code, headings (as bold paragraphs), and inline code, bold,
 * italics and links (their text only). Everything else stays literal text. The renderer turns the
 * result into text nodes, so no model output ever reaches `innerHTML`.
 */
export function parseInsightMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let items: string[][] = [];
  let code: string[] | undefined;

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
    if (items.length === 0) {
      return;
    }

    blocks.push({ kind: 'list', items: items.map((item) => parseInline(item.join(' '))) });
    items = [];
  };

  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    if (code !== undefined) {
      if (fence.test(line)) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = undefined;
      } else {
        code.push(line);
      }
      continue;
    }
    if (fence.test(line)) {
      flush();
      code = [];
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const item = listItem.exec(line);
    if (item !== null) {
      if (paragraph.length > 0) {
        flush();
      }
      items.push([item[1] ?? '']);
      continue;
    }
    const title = heading.exec(line);
    if (title !== null) {
      flush();
      blocks.push({ kind: 'paragraph', spans: [{ kind: 'strong', text: title[1] ?? '' }] });
      continue;
    }
    const last = items.at(-1);
    if (last !== undefined && line.startsWith(' ')) {
      last.push(line.trim());
    } else {
      if (items.length > 0) {
        flush();
      }
      paragraph.push(line.trim());
    }
  }
  if (code !== undefined) {
    blocks.push({ kind: 'code', text: code.join('\n') });
  }
  flush();
  return blocks;
}

function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let cursor = 0;
  for (const match of text.matchAll(inline)) {
    if (match.index > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    const [, codeText, strong, strongAlt, link, emphasis, emphasisAlt] = match;
    if (codeText !== undefined) {
      spans.push({ kind: 'code', text: codeText });
    } else if (strong !== undefined || strongAlt !== undefined) {
      spans.push({ kind: 'strong', text: strong ?? strongAlt ?? '' });
    } else if (link === undefined) {
      spans.push({ kind: 'emphasis', text: emphasis ?? emphasisAlt ?? '' });
    } else {
      spans.push({ kind: 'text', text: link });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ kind: 'text', text: text.slice(cursor) });
  }
  return spans;
}
