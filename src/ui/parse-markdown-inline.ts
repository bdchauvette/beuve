import type { MarkdownInline } from './markdown-tree.ts';
import { safeHrefFrom } from './safe-href-from.ts';

export interface InlineOptions {
  /**
   * The text is the unfinished end of a streaming answer: a construct still being written
   * renders as what it will most likely become instead of flickering through literal syntax.
   */
  readonly isProvisional?: boolean;
}

interface Context {
  readonly text: string;
  readonly isProvisional: boolean;
  readonly isInLink: boolean;
}

/** What the construct at an index gives: its nodes and where parsing goes on. */
interface Step {
  readonly nodes: readonly MarkdownInline[];
  readonly next: number;
}

/**
 * Parses what starts at `at`: a step, `stop` (a provisional end that is hidden until more of
 * it arrives) or `undefined` when nothing starts there and the character is text.
 */
type Construct = (context: Context, at: number, to: number) => Step | 'stop' | undefined;

const marker = /\[\[[^[\]\n]{1,512}\]\]/uy;
const unfinishedMarker = /\[\[[^[\]\n]*\]?$/uy;
const autolink = /<(https?:\/\/[^\s<>]+)>/uy;
const bareUrl = /https?:\/\/[^\s<>]+/uy;
const urlTrailer = /[.,;:!?'"*_~]+$/u;
const punctuation = /[!-/:-@[-`{-~]/u;
const wordCharacter = /[\p{L}\p{N}]/u;
const whitespace = /\s/u;

/**
 * Parses the inline Markdown of one block (ADR 0073): backslash escapes, code spans, `**strong**`
 * and `*emphasis*` (also with `_`, never inside a word, so `snake_case` stays text), links
 * `[text](url "title")` and `<url>` autolinks, bare `http(s)://` URLs, and `[[path:a-b]]` line
 * citations as `marker`s. Raw HTML is text. A link whose URL is not `http(s)` keeps only its text.
 * With `isProvisional`, an unclosed code span or strong run extends to the end, a link still being
 * written shows its text, and a citation still being written is hidden (ADR 0031). Pure.
 */
export function parseMarkdownInline(text: string, options: InlineOptions = {}): MarkdownInline[] {
  const context = { text, isProvisional: options.isProvisional ?? false, isInLink: false };
  return parseRange(context, 0, text.length);
}

function parseRange(context: Context, from: number, to: number): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let index = from;
  while (index < to) {
    const character = context.text.charAt(index);
    const step = constructs[character]?.(context, index, to) ?? {
      nodes: [{ kind: 'text', text: character }],
      next: index + 1,
    };
    if (step === 'stop') {
      break;
    }
    for (const node of step.nodes) {
      appendInline(nodes, node);
    }
    index = step.next;
  }
  return nodes;
}

/** Appends a node, joining it to the text before it. */
function appendInline(nodes: MarkdownInline[], node: MarkdownInline): void {
  const last = nodes.at(-1);
  if (node.kind === 'text' && last?.kind === 'text') {
    nodes[nodes.length - 1] = { kind: 'text', text: last.text + node.text };
  } else {
    nodes.push(node);
  }
}

/** Whether `to` is the end of a provisional text: only there may a construct be unfinished. */
function isOpenEnd(context: Context, to: number): boolean {
  return context.isProvisional && to === context.text.length;
}

function escapeAt(context: Context, at: number, to: number): Step | 'stop' | undefined {
  const next = context.text.charAt(at + 1);
  if (at + 1 < to && punctuation.test(next)) {
    return { nodes: [{ kind: 'text', text: next }], next: at + 2 };
  }
  return isOpenEnd(context, to) && at + 1 === to ? 'stop' : undefined;
}

function codeAt(context: Context, at: number, to: number): Step | 'stop' {
  const { text } = context;
  const ticks = runLength(text, at, to);
  const close = closingTicks(text, at + ticks, to, ticks);
  if (close !== undefined) {
    return {
      nodes: [{ kind: 'code', text: codeText(text.slice(at + ticks, close)) }],
      next: close + ticks,
    };
  }
  if (!isOpenEnd(context, to)) {
    return { nodes: [{ kind: 'text', text: text.slice(at, at + ticks) }], next: at + ticks };
  }
  const rest = text.slice(at + ticks, to);
  return rest === '' ? 'stop' : { nodes: [{ kind: 'code', text: codeText(rest) }], next: to };
}

function bracketAt(context: Context, at: number, to: number): Step | 'stop' | undefined {
  const { text } = context;
  const cited = matchAt(marker, text, at, to);
  if (cited !== undefined) {
    return { nodes: [{ kind: 'marker', text: cited }], next: at + cited.length };
  }
  const isOpen = isOpenEnd(context, to);
  if (isOpen && matchAt(unfinishedMarker, text, at, to) !== undefined) {
    return 'stop';
  }
  if (context.isInLink) {
    return undefined;
  }
  const link = linkAt(text, at, to);
  const label = (end: number): MarkdownInline[] =>
    parseRange({ ...context, isInLink: true }, at + 1, end);
  if (link.kind === 'link') {
    const children = label(link.labelEnd);
    const nodes: MarkdownInline[] =
      link.href === undefined ? children : [{ kind: 'link', href: link.href, children }];
    return { nodes, next: link.end };
  }
  // `[text` or `[text](http…` still being written: its text, never its syntax.
  return isOpen && link.kind === 'unfinished'
    ? { nodes: label(link.labelEnd ?? to), next: to }
    : undefined;
}

function autolinkAt(context: Context, at: number, to: number): Step | undefined {
  const url = context.isInLink ? undefined : matchAt(autolink, context.text, at, to);
  const href = url === undefined ? undefined : safeHrefFrom(url.slice(1, -1));
  if (url === undefined || href === undefined) {
    return undefined;
  }
  return {
    nodes: [{ kind: 'link', href, children: [{ kind: 'text', text: url.slice(1, -1) }] }],
    next: at + url.length,
  };
}

/** A bare `http(s)://` URL, without trailing punctuation or a `)` it doesn't open. */
function bareUrlAt(context: Context, at: number, to: number): Step | undefined {
  const { text } = context;
  if (context.isInLink || wordCharacter.test(text.charAt(at - 1))) {
    return undefined;
  }
  let url = matchAt(bareUrl, text, at, to)?.replace(urlTrailer, '') ?? '';
  while (url.endsWith(')') && count(url, '(') < count(url, ')')) {
    url = url.slice(0, -1).replace(urlTrailer, '');
  }
  const href = safeHrefFrom(url);
  if (href === undefined) {
    return undefined;
  }
  return {
    nodes: [{ kind: 'link', href, children: [{ kind: 'text', text: url }] }],
    next: at + url.length,
  };
}

/**
 * `*x*`, `**x**` or `***x***` (or with `_`) at `at`. An opener is followed by a non-space (and,
 * for `_`, not preceded by a letter or digit); its closer is the next run of the same length
 * preceded by a non-space, skipping code spans, citations and escapes. Provisionally, an
 * unclosed strong run, or emphasis opened after a space, runs to the end.
 */
function emphasisAt(context: Context, at: number, to: number): Step | 'stop' {
  const { text } = context;
  const character = text.charAt(at);
  const length = runLength(text, at, to);
  const isOpen = isOpenEnd(context, to);
  if (isOpen && at + length === to) {
    return 'stop';
  }
  const next = text.charAt(at + length);
  const previous = text.charAt(at - 1);
  const canOpen =
    length <= 3 &&
    next !== '' &&
    !whitespace.test(next) &&
    !(character === '_' && wordCharacter.test(previous));
  const close = canOpen ? closingRun(text, at + length, to, character, length) : undefined;
  const isLikely = length >= 2 || previous === '' || whitespace.test(previous);
  if (!canOpen || (close === undefined && !(isOpen && isLikely))) {
    return { nodes: [{ kind: 'text', text: text.slice(at, at + length) }], next: at + length };
  }
  const children = parseRange(context, at + length, close ?? to);
  const node: MarkdownInline =
    length === 1
      ? { kind: 'emphasis', children }
      : length === 2
        ? { kind: 'strong', children }
        : { kind: 'strong', children: [{ kind: 'emphasis', children }] };
  return { nodes: [node], next: close === undefined ? to : close + length };
}

const constructs: Readonly<Partial<Record<string, Construct>>> = Object.freeze({
  '\\': escapeAt,
  '`': codeAt,
  '[': bracketAt,
  '<': autolinkAt,
  h: bareUrlAt,
  '*': emphasisAt,
  _: emphasisAt,
});

function runLength(text: string, at: number, to: number): number {
  let end = at;
  while (end < to && text.charAt(end) === text.charAt(at)) {
    end += 1;
  }
  return end - at;
}

/** Where a run of exactly `ticks` backticks starts, after `from`. */
function closingTicks(text: string, from: number, to: number, ticks: number): number | undefined {
  let index = from;
  while (index < to) {
    const length = text.charAt(index) === '`' ? runLength(text, index, to) : 0;
    if (length === ticks) {
      return index;
    }
    index += Math.max(length, 1);
  }
  return undefined;
}

/** A code span's text: line breaks are spaces, and one space each side is padding. */
function codeText(raw: string): string {
  const text = raw.replaceAll('\n', ' ');
  return text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== ''
    ? text.slice(1, -1)
    : text;
}

function matchAt(pattern: RegExp, text: string, at: number, to: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(text.slice(0, to))?.[0];
}

/** Just past an escape, a closed code span or a citation at `at`; `undefined` if none is there. */
function skipAtom(text: string, at: number, to: number): number | undefined {
  const character = text.charAt(at);
  if (character === '\\') {
    return at + 2;
  }
  if (character === '`') {
    const ticks = runLength(text, at, to);
    return (closingTicks(text, at + ticks, to, ticks) ?? at) + ticks;
  }
  const cited = character === '[' ? matchAt(marker, text, at, to) : undefined;
  return cited === undefined ? undefined : at + cited.length;
}

type LinkMatch =
  | { readonly kind: 'none' }
  /** The text ran out first; `labelEnd` is set once the label is closed. */
  | { readonly kind: 'unfinished'; readonly labelEnd?: number }
  | {
      readonly kind: 'link';
      readonly labelEnd: number;
      readonly end: number;
      readonly href?: string;
    };

/** `[label](destination "title")` at `at`; the label may hold code spans and nested brackets. */
function linkAt(text: string, at: number, to: number): LinkMatch {
  const labelEnd = labelEndAt(text, at + 1, to);
  if (labelEnd === undefined) {
    return { kind: 'unfinished' };
  }
  if (labelEnd + 1 >= to) {
    return { kind: 'unfinished', labelEnd };
  }
  const destination =
    text.charAt(labelEnd + 1) === '(' ? destinationAt(text, labelEnd + 2, to) : undefined;
  if (destination === 'unfinished') {
    return { kind: 'unfinished', labelEnd };
  }
  if (destination === undefined) {
    return { kind: 'none' };
  }
  const href = safeHrefFrom(destination.url);
  return { kind: 'link', labelEnd, end: destination.end, ...(href !== undefined && { href }) };
}

/** The `]` that closes a label opened just before `from`, skipping atoms and nested brackets. */
function labelEndAt(text: string, from: number, to: number): number | undefined {
  let depth = 0;
  let index = from;
  while (index < to) {
    const skipped = skipAtom(text, index, to);
    const character = skipped === undefined ? text.charAt(index) : '';
    if (character === ']' && depth === 0) {
      return index;
    }
    depth += character === '[' ? 1 : character === ']' ? -1 : 0;
    index = skipped ?? index + 1;
  }
  return undefined;
}

/** `url "title")` from just after the `(`: the URL and just past the `)`. */
function destinationAt(
  text: string,
  from: number,
  to: number,
): 'unfinished' | { readonly url: string; readonly end: number } | undefined {
  const start = skipSpaces(text, from, to);
  const isAngled = text.charAt(start) === '<';
  const urlEnd = isAngled ? text.indexOf('>', start) : plainUrlEnd(text, start, to);
  if (urlEnd === -1 || urlEnd >= to) {
    return 'unfinished';
  }
  const url = text.slice(isAngled ? start + 1 : start, urlEnd);
  let index = skipSpaces(text, isAngled ? urlEnd + 1 : urlEnd, to);
  const quote = text.charAt(index);
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, index + 1);
    if (close === -1 || close >= to) {
      return 'unfinished';
    }
    index = skipSpaces(text, close + 1, to);
  }
  if (index >= to) {
    return 'unfinished';
  }
  return text.charAt(index) === ')' ? { url, end: index + 1 } : undefined;
}

/** Where an unbracketed URL ends: at a space or a `)` it didn't open; `to` if neither came. */
function plainUrlEnd(text: string, from: number, to: number): number {
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    const character = text.charAt(index);
    if (whitespace.test(character) || (character === ')' && depth === 0)) {
      return index;
    }
    depth += character === '(' ? 1 : character === ')' ? -1 : 0;
  }
  return to;
}

function skipSpaces(text: string, from: number, to: number): number {
  let index = from;
  while (index < to && whitespace.test(text.charAt(index))) {
    index += 1;
  }
  return index;
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

function closingRun(
  text: string,
  from: number,
  to: number,
  character: string,
  length: number,
): number | undefined {
  let index = from;
  while (index < to) {
    const skipped = skipAtom(text, index, to);
    const run =
      skipped === undefined && text.charAt(index) === character ? runLength(text, index, to) : 0;
    const isCloser =
      run === length &&
      index > from &&
      !whitespace.test(text.charAt(index - 1)) &&
      !(character === '_' && wordCharacter.test(text.charAt(index + run)));
    if (isCloser) {
      return index;
    }
    index = skipped ?? index + Math.max(run, 1);
  }
  return undefined;
}
