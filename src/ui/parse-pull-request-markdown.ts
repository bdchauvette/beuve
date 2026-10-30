import { parseMarkdownSubset } from './parse-markdown-subset.ts';
import type { InlineSpan, MarkdownBlock } from './parse-markdown-subset.ts';

/** An inline run of a pull request body: the Markdown subset's spans, plus links. */
export type BodySpan =
  InlineSpan | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type BodyBlock =
  | { readonly kind: 'paragraph'; readonly spans: readonly BodySpan[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly BodySpan[])[] }
  | { readonly kind: 'code'; readonly text: string };

type LinkSpan = Extract<BodySpan, { kind: 'link' }>;

const markdownLink =
  /\[([^\]\n]{1,500})\]\((https:\/\/[^\s)]{1,2000})\)|(https:\/\/[^\s<>()\]]{1,2000})/gu;
const sentinel = /(\d+)/gu;
const sentinelCharacters = /[]/gu;
const trailingPunctuation = /[.,;:!?'"]+$/u;

/**
 * Parses a pull request body (untrusted Markdown written on GitHub) into blocks the intent
 * section renders as text nodes: the Markdown subset (ADR 0022) plus `https://` links, both
 * `[text](https://…)` and bare URLs, as `link` spans. Other link schemes stay text. Links are
 * swapped for placeholders before the subset parses, so URLs with underscores aren't emphasis,
 * and links inside code stay literal. The UI asks main to open a link, which opens only GitHub
 * ones (ADR 0040). Pure.
 */
export function parsePullRequestMarkdown(body: string): BodyBlock[] {
  const links: LinkSpan[] = [];
  const literals: string[] = [];
  const source = body
    .replaceAll(sentinelCharacters, '')
    .replaceAll(
      markdownLink,
      (
        whole: string,
        text: string | undefined,
        href: string | undefined,
        bare: string | undefined,
      ) => {
        const url = bare?.replace(trailingPunctuation, '') ?? href ?? '';
        const rest = bare === undefined ? '' : bare.slice(url.length);
        links.push({ kind: 'link', text: text ?? url, href: url });
        literals.push(bare === undefined ? whole : url);
        return `${String(links.length - 1)}${rest}`;
      },
    );
  const restore = (text: string): string =>
    text.replaceAll(sentinel, (_whole: string, index: string) => literals[Number(index)] ?? '');
  const spansFrom = (spans: readonly InlineSpan[]): BodySpan[] =>
    spans.flatMap((span) =>
      span.kind === 'text' ? splitLinks(span.text, links) : { ...span, text: restore(span.text) },
    );
  return parseMarkdownSubset(source).map((block) => blockFrom(block, spansFrom, restore));
}

function blockFrom(
  block: MarkdownBlock,
  spansFrom: (spans: readonly InlineSpan[]) => BodySpan[],
  restore: (text: string) => string,
): BodyBlock {
  switch (block.kind) {
    case 'paragraph': {
      return { kind: 'paragraph', spans: spansFrom(block.spans) };
    }
    case 'list': {
      return { kind: 'list', items: block.items.map((item) => spansFrom(item)) };
    }
    case 'code': {
      return { kind: 'code', text: restore(block.text) };
    }
  }
}

function splitLinks(text: string, links: readonly LinkSpan[]): BodySpan[] {
  const spans: BodySpan[] = [];
  let cursor = 0;
  for (const match of text.matchAll(sentinel)) {
    if (match.index > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    const link = links[Number(match[1])];
    if (link !== undefined) {
      spans.push(link);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ kind: 'text', text: text.slice(cursor) });
  }
  return spans;
}
