import { classifyMarkdownLine } from './classify-markdown-line.ts';
import type { MarkdownLine } from './classify-markdown-line.ts';
import { tableAlignmentsFrom } from './table-alignments-from.ts';
import { tableCellsFrom } from './table-cells-from.ts';

export interface SplitMarkdown {
  /** The source of each top-level block that later text can no longer change, in order. */
  readonly blocks: readonly string[];
  /** The rest, from the start of the block still open (or the unfinished last line) on. */
  readonly rest: string;
}

type OpenBlock =
  | { readonly kind: 'fence'; readonly fence: string }
  | { readonly kind: 'paragraph'; readonly first: string; readonly lines: number }
  | { readonly kind: 'table' }
  | { readonly kind: 'quote' }
  /** `end` is where its last non-blank line ends: trailing blank lines are not its own. */
  | { readonly kind: 'list'; readonly indent: number; readonly end: number };

/**
 * Splits Markdown into top-level blocks, line by line (ADR 0073). Without `final`, the last line
 * is unfinished unless the source ends with a line break, and a block is only given once it is
 * complete: its closing fence, a heading or rule line, a blank line, or the first line of the next
 * block. What stays open is `rest`, so a streaming renderer splits `rest + delta` again and
 * renders each block once. With `final` (the end of the text) everything is a block. A block's
 * extent depends only on its own lines and the one after it, so splitting a text in pieces gives
 * the same blocks as splitting it whole. Pure.
 */
export function splitMarkdownBlocks(
  source: string,
  options: { readonly isFinal: boolean },
): SplitMarkdown {
  const blocks: string[] = [];
  let open: OpenBlock | undefined;
  let start = 0;

  const commit = (end: number): void => {
    blocks.push(source.slice(start, end));
    open = undefined;
    start = end;
  };
  const begin = (line: Line, kind: MarkdownLine): void => {
    start = line.start;
    switch (kind.kind) {
      case 'blank': {
        start = line.end;
        return;
      }
      case 'heading':
      case 'rule': {
        commit(line.end);
        return;
      }
      case 'fence': {
        open = { kind: 'fence', fence: kind.fence };
        return;
      }
      case 'item': {
        open = { kind: 'list', indent: kind.indent, end: line.end };
        return;
      }
      case 'quote': {
        open = { kind: 'quote' };
        return;
      }
      case 'text': {
        open = { kind: 'paragraph', first: line.text, lines: 1 };
        return;
      }
    }
  };

  for (const line of linesOf(source, options.isFinal)) {
    const kind = classifyMarkdownLine(line.text);
    const state = open;
    if (state === undefined) {
      begin(line, kind);
      continue;
    }
    const verdict = continues(state, line, kind);
    if (verdict === 'yes') {
      open = grown(state, line, kind);
    } else if (verdict === 'last') {
      commit(line.end);
    } else {
      commit(state.kind === 'list' ? state.end : line.start);
      begin(line, kind);
    }
  }
  if (options.isFinal) {
    if (open !== undefined) {
      commit(open.kind === 'list' ? open.end : source.length);
    }
    return { blocks, rest: '' };
  }
  return { blocks, rest: source.slice(start) };
}

interface Line {
  /** The line without its break (and without a `\r` before it). */
  readonly text: string;
  readonly start: number;
  /** Just past the line break. */
  readonly end: number;
}

function linesOf(source: string, isFinal: boolean): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    const lineBreak = source.indexOf('\n', start);
    if (lineBreak === -1 && !isFinal) {
      break;
    }
    const end = lineBreak === -1 ? source.length : lineBreak + 1;
    const raw = source.slice(start, lineBreak === -1 ? source.length : lineBreak);
    lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start, end });
    start = end;
  }
  return lines;
}

/** Whether `line` belongs to the open block: `last` when it is the block's closing line. */
function continues(open: OpenBlock, line: Line, kind: MarkdownLine): 'yes' | 'no' | 'last' {
  switch (open.kind) {
    case 'fence': {
      return kind.kind === 'fence' &&
        kind.info === '' &&
        kind.fence.startsWith(open.fence.charAt(0)) &&
        kind.fence.length >= open.fence.length
        ? 'last'
        : 'yes';
    }
    case 'paragraph': {
      return kind.kind === 'text' || isTableStart(open, line) ? 'yes' : 'no';
    }
    case 'table': {
      return kind.kind === 'text' && line.text.includes('|') ? 'yes' : 'no';
    }
    case 'quote': {
      return kind.kind === 'quote' ? 'yes' : 'no';
    }
    case 'list': {
      return kind.kind === 'blank' || kind.kind === 'item' || kind.indent > open.indent
        ? 'yes'
        : 'no';
    }
  }
}

function grown(open: OpenBlock, line: Line, kind: MarkdownLine): OpenBlock {
  switch (open.kind) {
    case 'paragraph': {
      return isTableStart(open, line) ? { kind: 'table' } : { ...open, lines: open.lines + 1 };
    }
    case 'list': {
      return kind.kind === 'blank' ? open : { ...open, end: line.end };
    }
    case 'fence':
    case 'table':
    case 'quote': {
      return open;
    }
  }
}

/** A one-line paragraph with pipes, then a delimiter row with as many columns: a table. */
function isTableStart(open: Extract<OpenBlock, { kind: 'paragraph' }>, line: Line): boolean {
  return (
    open.lines === 1 &&
    open.first.includes('|') &&
    tableAlignmentsFrom(line.text)?.length === tableCellsFrom(open.first).length
  );
}
