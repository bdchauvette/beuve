/** What one line of Markdown starts (ADR 0073); `indent` counts columns, a tab as four. */
export type MarkdownLine =
  | { readonly kind: 'blank' }
  | {
      readonly kind: 'fence';
      readonly indent: number;
      /** The fence itself, e.g. ```` ``` ```` or `~~~~`; a closing fence repeats its character. */
      readonly fence: string;
      readonly info: string;
    }
  | {
      readonly kind: 'heading';
      readonly indent: number;
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly text: string;
    }
  | { readonly kind: 'rule'; readonly indent: number }
  | {
      readonly kind: 'item';
      readonly indent: number;
      /** `-`, `*` or `+` for a bullet; `.` or `)` for an ordered item. */
      readonly marker: string;
      readonly start?: number;
      /** The column the item's content starts at; continuation lines are dedented by it. */
      readonly contentIndent: number;
      readonly text: string;
    }
  | { readonly kind: 'quote'; readonly indent: number; readonly text: string }
  | { readonly kind: 'text'; readonly indent: number; readonly text: string };

const fenceLine = /^(`{3,}|~{3,})(.*)$/u;
const ruleCharacters = /^[-*_][-*_ \t]*$/u;
const quoteLine = /^> ?(.*)$/u;
const digits = /^\d{1,9}/u;
const trailingHashes = /#+$/u;
const spaces = /[ \t]/gu;

/**
 * Classifies one line (no line break) by the block it starts: the line-level half of the
 * Markdown subset, shared by the block splitter and the block parser so they always agree.
 * Up to three spaces of indentation are allowed before a fence, heading, rule or quote; a list
 * item may be indented any amount (nesting). Indented code blocks are not supported: such a
 * line is text. Pure.
 */
export function classifyMarkdownLine(line: string): MarkdownLine {
  const indent = indentOf(line);
  const body = line.trimStart();
  if (body === '') {
    return { kind: 'blank' };
  }
  if (indent <= 3) {
    const fence = fenceLine.exec(body);
    const info = fence?.[2]?.trim() ?? '';
    if (fence?.[1] !== undefined && !(fence[1].startsWith('`') && info.includes('`'))) {
      return { kind: 'fence', indent, fence: fence[1], info };
    }
    if (isRule(body)) {
      return { kind: 'rule', indent };
    }
    const heading = headingFrom(body, indent);
    if (heading !== undefined) {
      return heading;
    }
    const quote = quoteLine.exec(body);
    if (quote !== null) {
      return { kind: 'quote', indent, text: quote[1] ?? '' };
    }
  }
  return itemFrom(body, indent) ?? { kind: 'text', indent, text: body };
}

/** The column a line's content starts at, a tab counting as four. */
function indentOf(line: string): number {
  let columns = 0;
  for (const character of line) {
    if (character === ' ') {
      columns += 1;
    } else if (character === '\t') {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
  }
  return columns;
}

/** Three or more of one of `-`, `*` or `_`, with only spaces between. */
function isRule(body: string): boolean {
  if (!ruleCharacters.test(body)) {
    return false;
  }
  const marks = body.replaceAll(spaces, '');
  return marks.length >= 3 && marks.split('').every((mark) => mark === marks.charAt(0));
}

/** `#` to `######`, then a space or the end; closing `#`s after a space are dropped. */
function headingFrom(body: string, indent: number): MarkdownLine | undefined {
  let level = 0;
  while (body.charAt(level) === '#') {
    level += 1;
  }
  const after = body.charAt(level);
  if (level === 0 || level > 6 || !['', ' ', '\t'].includes(after)) {
    return undefined;
  }
  let text = body.slice(level).trim();
  const unhashed = text.replace(trailingHashes, '');
  if (unhashed === '' || unhashed.endsWith(' ') || unhashed.endsWith('\t')) {
    text = unhashed.trim();
  }
  return { kind: 'heading', indent, level: level as 1 | 2 | 3 | 4 | 5 | 6, text };
}

/** A bullet (`-`, `*`, `+`) or an ordered item (`1.`, `1)`), then a space or the end. */
function itemFrom(body: string, indent: number): MarkdownLine | undefined {
  const number = digits.exec(body)?.[0];
  const markerWidth = (number?.length ?? 0) + 1;
  const marker = body.charAt(markerWidth - 1);
  const rest = body.slice(markerWidth);
  const isSpaced = rest === '' || rest.startsWith(' ') || rest.startsWith('\t');
  if (marker === '' || !isSpaced || !isItemMarker(marker, number)) {
    return undefined;
  }
  const text = rest.trimStart();
  const gap = contentGap(text, rest.length - text.length);
  return {
    kind: 'item',
    indent,
    marker,
    ...(number !== undefined && { start: Number(number) }),
    contentIndent: indent + markerWidth + gap,
    text: text.trim(),
  };
}

/** `-`, `*` or `+` for a bullet; `.` or `)` after an ordered item's number. */
function isItemMarker(marker: string, number: string | undefined): boolean {
  if (number === undefined) {
    return '-*+'.includes(marker);
  }
  return marker === '.' || marker === ')';
}

/**
 * The columns between the marker and the content: the spaces themselves, but a wide gap (or
 * none, on an empty item) means the content starts one column after the marker.
 */
function contentGap(text: string, spacing: number): number {
  if (text !== '' && spacing > 0 && spacing <= 4) {
    return spacing;
  }
  return 1;
}
