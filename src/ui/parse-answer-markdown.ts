import type { ChatCitationView } from '#contract/ipc-contract.ts';

import { citationMarker } from './citation-marker.ts';
import { parseMarkdownSubset } from './parse-markdown-subset.ts';
import type { InlineSpan, MarkdownBlock } from './parse-markdown-subset.ts';

/** An inline run of an answer: the Markdown subset's spans, plus citations and raw markers. */
export type AnswerSpan =
  | InlineSpan
  /** A `[[path:start-end]]` listed in the message's citations: rendered as a pill. */
  | { readonly kind: 'citation'; readonly citation: ChatCitationView }
  /** A marker in an answer still streaming: shown dimmed until the answer is validated. */
  | { readonly kind: 'marker'; readonly text: string };

export type AnswerBlock =
  | { readonly kind: 'paragraph'; readonly spans: readonly AnswerSpan[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly AnswerSpan[])[] }
  | { readonly kind: 'code'; readonly text: string };

type Token = AnswerSpan & { readonly kind: 'citation' | 'marker' };

const bracketed = /\[\[([^[\]\n]{1,512})\]\]/gu;
const unfinishedMarker = /\[\[[^\]\n]*\]?$/u;
const sentinel = /(\d+)/gu;
const sentinelCharacters = /[]/gu;

/**
 * Parses a model answer (untrusted Markdown) into blocks the drawer renders as text nodes. A
 * `final` answer turns each exact `[[path:start-end]]` of `citations` into a citation span and
 * leaves every other marker as literal text; a `streaming` one shows every well-formed marker as
 * a dimmed `marker` and hides a marker still being written (ADR 0031). Markers are swapped for
 * placeholders before the Markdown subset parses, so a path with underscores or asterisks can't
 * be mistaken for emphasis, and markers inside code stay literal.
 */
export function parseAnswerMarkdown(
  content: string,
  citations: readonly ChatCitationView[],
  mode: 'final' | 'streaming',
): AnswerBlock[] {
  const known = new Map(citations.map((citation) => [citationMarker(citation), citation]));
  const tokens: Token[] = [];
  const literals: string[] = [];
  const clean = content.replaceAll(sentinelCharacters, '');
  const visible = mode === 'streaming' ? clean.replace(unfinishedMarker, '') : clean;
  const source = visible.replaceAll(bracketed, (marker: string) => {
    const citation = known.get(marker);
    if (mode === 'final' && citation === undefined) {
      return marker;
    }
    tokens.push(
      citation === undefined || mode === 'streaming'
        ? { kind: 'marker', text: marker }
        : { kind: 'citation', citation },
    );
    literals.push(marker);
    return `${String(tokens.length - 1)}`;
  });
  const restore = (text: string): string =>
    text.replaceAll(sentinel, (_whole: string, index: string) => literals[Number(index)] ?? '');
  const toSpans = (spans: readonly InlineSpan[]): AnswerSpan[] =>
    spans.flatMap((span) =>
      span.kind === 'text' ? splitTokens(span.text, tokens) : { ...span, text: restore(span.text) },
    );
  return parseMarkdownSubset(source).map((block): AnswerBlock => toBlock(block, toSpans, restore));
}

function toBlock(
  block: MarkdownBlock,
  toSpans: (spans: readonly InlineSpan[]) => AnswerSpan[],
  restore: (text: string) => string,
): AnswerBlock {
  switch (block.kind) {
    case 'paragraph': {
      return { kind: 'paragraph', spans: toSpans(block.spans) };
    }
    case 'list': {
      return { kind: 'list', items: block.items.map((item) => toSpans(item)) };
    }
    case 'code': {
      return { kind: 'code', text: restore(block.text) };
    }
  }
}

function splitTokens(text: string, tokens: readonly Token[]): AnswerSpan[] {
  const spans: AnswerSpan[] = [];
  let cursor = 0;
  for (const match of text.matchAll(sentinel)) {
    if (match.index > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    const replaced = tokens[Number(match[1])];
    if (replaced !== undefined) {
      spans.push(replaced);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ kind: 'text', text: text.slice(cursor) });
  }
  return spans;
}
