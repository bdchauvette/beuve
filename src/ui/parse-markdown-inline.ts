import type { MarkdownInline } from './markdown-tree.ts';
import { safeHrefFrom } from './safe-href-from.ts';

export interface InlineOptions {
  /**
   * The text is the unfinished end of a streaming answer: a construct still being written
   * renders as what it will most likely become instead of flickering through literal syntax.
   */
  readonly isProvisional?: boolean;
}

/** A text and the end (exclusive) of the range being parsed in it. */
interface Scan {
  readonly text: string;
  readonly end: number;
}

interface Context extends Scan {
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
type Construct = (context: Context, at: number) => Step | 'stop' | undefined;

/** A link destination's URL, and just past it. */
interface UrlSpan {
  readonly url: string;
  readonly end: number;
}

const marker = /\[\[[^[\]\n]{1,512}\]\]/uy;
const unfinishedMarker = /\[\[[^[\]\n]*\]?$/uy;
const autolink = /<(https?:\/\/[^\s<>]+)>/uy;
const bareUrl = /https?:\/\/[^\s<>]+/uy;
const urlTrailer = /[.,;:!?'"*_~]+$/u;
const punctuation = /[!-/:-@[-`{-~]/u;
const wordCharacter = /[\p{L}\p{N}]/u;
const whitespace = /\s/u;
const bracketDepth: Readonly<Record<string, number>> = { '[': 1, ']': -1 };
const parenDepth: Readonly<Record<string, number>> = { '(': 1, ')': -1 };

/**
 * Parses the inline Markdown of one block (ADR 0073): backslash escapes, code spans, `**strong**`
 * and `*emphasis*` (also with `_`, never inside a word, so `snake_case` stays text), links
 * `[text](url "title")` and `<url>` autolinks, bare `http(s)://` URLs, and `[[path:a-b]]` line
 * citations as `marker`s. Raw HTML is text. A link whose URL is not `http(s)` keeps only its text.
 * With `isProvisional`, an unclosed code span or strong run extends to the end, a link still being
 * written shows its text, and a citation still being written is hidden (ADR 0031). Pure.
 */
export function parseMarkdownInline(text: string, options: InlineOptions = {}): MarkdownInline[] {
  const context = {
    text,
    end: text.length,
    isProvisional: options.isProvisional ?? false,
    isInLink: false,
  };
  return parseRange(context, 0);
}

/** The nodes from `from` to the context's end. */
function parseRange(context: Context, from: number): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let index = from;
  while (index < context.end) {
    const character = context.text.charAt(index);
    const step = constructs[character]?.(context, index) ?? {
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

/** Whether the range ends a provisional text: only there may a construct be unfinished. */
function isOpenEnd(context: Context): boolean {
  return context.isProvisional && context.end === context.text.length;
}

function escapeAt(context: Context, at: number): Step | 'stop' | undefined {
  const next = context.text.charAt(at + 1);
  if (at + 1 < context.end && punctuation.test(next)) {
    return { nodes: [{ kind: 'text', text: next }], next: at + 2 };
  }
  if (isOpenEnd(context) && at + 1 === context.end) {
    return 'stop';
  }
  return undefined;
}

function codeAt(context: Context, at: number): Step | 'stop' {
  const { text, end } = context;
  const ticks = runLength(context, at);
  const close = closingTicks(context, at);
  if (close !== undefined) {
    return {
      nodes: [{ kind: 'code', text: codeText(text.slice(at + ticks, close)) }],
      next: close + ticks,
    };
  }
  if (!isOpenEnd(context)) {
    return { nodes: [{ kind: 'text', text: text.slice(at, at + ticks) }], next: at + ticks };
  }
  const rest = text.slice(at + ticks, end);
  if (rest === '') {
    return 'stop';
  }
  return { nodes: [{ kind: 'code', text: codeText(rest) }], next: end };
}

function bracketAt(context: Context, at: number): Step | 'stop' | undefined {
  const cited = matchAt(marker, context, at);
  if (cited !== undefined) {
    return { nodes: [{ kind: 'marker', text: cited }], next: at + cited.length };
  }
  const isOpen = isOpenEnd(context);
  if (isOpen && matchAt(unfinishedMarker, context, at) !== undefined) {
    return 'stop';
  }
  if (context.isInLink) {
    return undefined;
  }
  const link = linkAt(context, at);
  const label = (end: number): MarkdownInline[] => {
    return parseRange({ ...context, end, isInLink: true }, at + 1);
  };
  if (link.kind === 'link') {
    const children = label(link.labelEnd);
    if (link.href === undefined) {
      return { nodes: children, next: link.end };
    }
    return { nodes: [{ kind: 'link', href: link.href, children }], next: link.end };
  }
  // `[text` or `[text](http…` still being written: its text, never its syntax.
  if (isOpen && link.kind === 'unfinished') {
    return { nodes: label(link.labelEnd ?? context.end), next: context.end };
  }
  return undefined;
}

function autolinkAt(context: Context, at: number): Step | undefined {
  if (context.isInLink) {
    return undefined;
  }
  const url = matchAt(autolink, context, at);
  if (url === undefined) {
    return undefined;
  }
  const href = safeHrefFrom(url.slice(1, -1));
  if (href === undefined) {
    return undefined;
  }
  return {
    nodes: [{ kind: 'link', href, children: [{ kind: 'text', text: url.slice(1, -1) }] }],
    next: at + url.length,
  };
}

/** A bare `http(s)://` URL, without trailing punctuation or a `)` it doesn't open. */
function bareUrlAt(context: Context, at: number): Step | undefined {
  if (context.isInLink || wordCharacter.test(context.text.charAt(at - 1))) {
    return undefined;
  }
  let url = matchAt(bareUrl, context, at)?.replace(urlTrailer, '') ?? '';
  while (url.endsWith(')') && isOverclosed(url)) {
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
function emphasisAt(context: Context, at: number): Step | 'stop' {
  const { text } = context;
  const character = text.charAt(at);
  const length = runLength(context, at);
  const isOpen = isOpenEnd(context);
  if (isOpen && at + length === context.end) {
    return 'stop';
  }
  const next = text.charAt(at + length);
  const previous = text.charAt(at - 1);
  const literal: Step = {
    nodes: [{ kind: 'text', text: text.slice(at, at + length) }],
    next: at + length,
  };
  const canOpen =
    length <= 3 &&
    next !== '' &&
    !whitespace.test(next) &&
    !(character === '_' && wordCharacter.test(previous));
  if (!canOpen) {
    return literal;
  }
  const close = closingRun(context, at);
  const isLikely = length >= 2 || previous === '' || whitespace.test(previous);
  if (close === undefined && !(isOpen && isLikely)) {
    return literal;
  }
  const children = parseRange({ ...context, end: close ?? context.end }, at + length);
  const node = emphasisNode(length, children);
  if (close === undefined) {
    return { nodes: [node], next: context.end };
  }
  return { nodes: [node], next: close + length };
}

/** Emphasis for one marker, strong for two, both for three. */
function emphasisNode(length: number, children: MarkdownInline[]): MarkdownInline {
  if (length === 1) {
    return { kind: 'emphasis', children };
  }
  if (length === 2) {
    return { kind: 'strong', children };
  }
  return { kind: 'strong', children: [{ kind: 'emphasis', children }] };
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

/** How many times the character at `at` repeats from there. */
function runLength(scan: Scan, at: number): number {
  let end = at;
  while (end < scan.end && scan.text.charAt(end) === scan.text.charAt(at)) {
    end += 1;
  }
  return end - at;
}

/** Where the run of backticks that closes the one at `opener` starts. */
function closingTicks(scan: Scan, opener: number): number | undefined {
  const ticks = runLength(scan, opener);
  let index = opener + ticks;
  while (index < scan.end) {
    let length = 0;
    if (scan.text.charAt(index) === '`') {
      length = runLength(scan, index);
    }
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
  if (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') {
    return text.slice(1, -1);
  }
  return text;
}

function matchAt(pattern: RegExp, scan: Scan, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(scan.text.slice(0, scan.end))?.[0];
}

/** Just past an escape, a closed code span or a citation at `at`; `undefined` if none is there. */
function skipAtom(scan: Scan, at: number): number | undefined {
  const character = scan.text.charAt(at);
  if (character === '\\') {
    return at + 2;
  }
  if (character === '`') {
    return (closingTicks(scan, at) ?? at) + runLength(scan, at);
  }
  if (character !== '[') {
    return undefined;
  }
  const cited = matchAt(marker, scan, at);
  if (cited === undefined) {
    return undefined;
  }
  return at + cited.length;
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
function linkAt(scan: Scan, at: number): LinkMatch {
  const labelEnd = labelEndAt(scan, at + 1);
  if (labelEnd === undefined) {
    return { kind: 'unfinished' };
  }
  if (labelEnd + 1 >= scan.end) {
    return { kind: 'unfinished', labelEnd };
  }
  if (scan.text.charAt(labelEnd + 1) !== '(') {
    return { kind: 'none' };
  }
  const destination = destinationAt(scan, labelEnd + 2);
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
function labelEndAt(scan: Scan, from: number): number | undefined {
  let depth = 0;
  let index = from;
  while (index < scan.end) {
    const skipped = skipAtom(scan, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    const character = scan.text.charAt(index);
    if (character === ']' && depth === 0) {
      return index;
    }
    depth += bracketDepth[character] ?? 0;
    index += 1;
  }
  return undefined;
}

/** `url "title")` from just after the `(`: the URL and just past the `)`. */
function destinationAt(scan: Scan, from: number): UrlSpan | 'unfinished' | undefined {
  const { text, end } = scan;
  const found = urlAt(scan, skipSpaces(scan, from));
  if (found === undefined) {
    return 'unfinished';
  }
  let index = skipSpaces(scan, found.end);
  const quote = text.charAt(index);
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, index + 1);
    if (close === -1 || close >= end) {
      return 'unfinished';
    }
    index = skipSpaces(scan, close + 1);
  }
  if (index >= end) {
    return 'unfinished';
  }
  if (text.charAt(index) === ')') {
    return { url: found.url, end: index + 1 };
  }
  return undefined;
}

/** The URL at `start`, `<…>` or bare, and just past it; `undefined` when the text ends first. */
function urlAt(scan: Scan, start: number): UrlSpan | undefined {
  const { text, end } = scan;
  if (text.charAt(start) === '<') {
    const close = text.indexOf('>', start);
    if (close === -1 || close >= end) {
      return undefined;
    }
    return { url: text.slice(start + 1, close), end: close + 1 };
  }
  const urlEnd = plainUrlEnd(scan, start);
  if (urlEnd >= end) {
    return undefined;
  }
  return { url: text.slice(start, urlEnd), end: urlEnd };
}

/** Where an unbracketed URL ends: at a space or a `)` it didn't open; the range's end if neither came. */
function plainUrlEnd(scan: Scan, from: number): number {
  let depth = 0;
  for (let index = from; index < scan.end; index += 1) {
    const character = scan.text.charAt(index);
    if (whitespace.test(character) || (character === ')' && depth === 0)) {
      return index;
    }
    depth += parenDepth[character] ?? 0;
  }
  return scan.end;
}

function skipSpaces(scan: Scan, from: number): number {
  let index = from;
  while (index < scan.end && whitespace.test(scan.text.charAt(index))) {
    index += 1;
  }
  return index;
}

/** Whether `url` closes more parentheses than it opens. */
function isOverclosed(url: string): boolean {
  return url.split('(').length < url.split(')').length;
}

/** Where the run that closes the emphasis run at `opener` starts. */
function closingRun(scan: Scan, opener: number): number | undefined {
  const { text } = scan;
  const character = text.charAt(opener);
  const length = runLength(scan, opener);
  const from = opener + length;
  let index = from;
  while (index < scan.end) {
    const skipped = skipAtom(scan, index);
    let run = 0;
    if (skipped === undefined && text.charAt(index) === character) {
      run = runLength(scan, index);
    }
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
