import { classifyMarkdownLine } from './classify-markdown-line.ts';
import type { MarkdownLine } from './classify-markdown-line.ts';
import type { MarkdownBlock, MarkdownInline } from './markdown-tree.ts';
import { parseMarkdownInline } from './parse-markdown-inline.ts';
import { splitMarkdownBlocks } from './split-markdown-blocks.ts';
import { tableAlignmentsFrom } from './table-alignments-from.ts';
import { tableCellsFrom } from './table-cells-from.ts';

export interface MarkdownOptions {
  /**
   * The text is the unfinished end of a streaming answer (the block splitter's `rest`): a last
   * line that is only block syntax so far (`#`, `-`, `` `` ``, `|--`) is hidden, a table's header
   * row waits for its delimiter row, and inline constructs still being written render as what
   * they will most likely become.
   */
  readonly isProvisional?: boolean;
}

type Item = Extract<MarkdownLine, { kind: 'item' }>;

const quotePrefix = /^ {0,3}> ?/u;
const whitespace = /\s/u;
const syntaxOnly = /^(?:[\s#>*+\-_=`~|:]*|\s*\d{1,9}[.)]?\s*)$/u;

/**
 * Parses untrusted Markdown into the subset beuve renders (ADR 0073): paragraphs, ATX headings,
 * fenced code, bullet and ordered lists (nested by indentation), block quotes, rules and GFM
 * tables, with the inline syntax of {@link parseMarkdownInline}. Raw HTML is text; setext
 * headings, indented code, reference links and images are not supported and stay text. The
 * blocks are {@link splitMarkdownBlocks}'s, so a streaming renderer that parses each finished
 * block once gets the same tree as parsing the whole text. Pure.
 */
export function parseMarkdown(source: string, options: MarkdownOptions = {}): MarkdownBlock[] {
  const isProvisional = options.isProvisional ?? false;
  let text = source;
  if (isProvisional) {
    text = withoutSyntaxOnlyEnd(source);
  }
  const { blocks } = splitMarkdownBlocks(text, { isFinal: true });
  return blocks.flatMap((block, index) => {
    return parseBlock(block, isProvisional && index === blocks.length - 1);
  });
}

/** Drops an unfinished last line that is only block syntax so far. */
function withoutSyntaxOnlyEnd(source: string): string {
  const lineStart = source.lastIndexOf('\n') + 1;
  if (syntaxOnly.test(source.slice(lineStart))) {
    return source.slice(0, lineStart);
  }
  return source;
}

function parseBlock(source: string, isProvisional: boolean): MarkdownBlock[] {
  const lines = linesOf(source);
  const first = lines[0];
  if (first === undefined) {
    return [];
  }
  const kind = classifyMarkdownLine(first);
  const inline = (text: string): MarkdownInline[] => {
    return parseMarkdownInline(text, { isProvisional });
  };
  switch (kind.kind) {
    case 'blank': {
      return [];
    }
    case 'heading': {
      return [{ kind: 'heading', level: kind.level, children: inline(kind.text) }];
    }
    case 'rule': {
      return [{ kind: 'rule' }];
    }
    case 'fence': {
      return [codeBlockFrom(lines, kind)];
    }
    case 'quote': {
      const inner = lines.map((line) => line.replace(quotePrefix, '')).join('\n');
      return [{ kind: 'quote', children: parseMarkdown(inner, { isProvisional }) }];
    }
    case 'item': {
      return listsFrom(lines, kind, isProvisional);
    }
    case 'text': {
      return [tableFrom(lines, isProvisional) ?? paragraphFrom(lines, isProvisional)].flatMap(
        (block) => {
          return block ?? [];
        },
      );
    }
  }
}

function linesOf(source: string): string[] {
  const lines = source.split('\n').map((line) => {
    if (line.endsWith('\r')) {
      return line.slice(0, -1);
    }
    return line;
  });
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/** A line that opens or closes a fenced code block. */
type FenceLine = Extract<MarkdownLine, { kind: 'fence' }>;

function codeBlockFrom(lines: readonly string[], open: FenceLine): MarkdownBlock {
  const body = lines.slice(1);
  const isClosed = isClosingFence(body.at(-1), open);
  let content = body;
  if (isClosed) {
    content = body.slice(0, -1);
  }
  return {
    kind: 'code',
    info: open.info.split(whitespace, 1)[0] ?? '',
    text: content.map((line) => dedent(line, open.indent)).join('\n'),
    closed: isClosed,
  };
}

/** A bare fence at least as long as `open`, of its character. */
function isClosingFence(last: string | undefined, open: FenceLine): boolean {
  if (last === undefined) {
    return false;
  }
  const closing = classifyMarkdownLine(last);
  return (
    closing.kind === 'fence' &&
    closing.info === '' &&
    closing.fence.startsWith(open.fence.charAt(0)) &&
    closing.fence.length >= open.fence.length
  );
}

/** Removes up to `columns` columns of leading spaces (a tab counts to the next multiple of 4). */
function dedent(line: string, columns: number): string {
  let column = 0;
  let index = 0;
  while (index < line.length && column < columns) {
    const character = line.charAt(index);
    if (character === ' ') {
      column += 1;
    } else if (character === '\t') {
      column += 4 - (column % 4);
    } else {
      break;
    }
    index += 1;
  }
  return line.slice(index);
}

/**
 * The items of a list block, each parsed as Markdown of its own (so a deeper item is a nested
 * list). An item line no deeper than the first item starts the next item; every other line
 * belongs to the current item, dedented by its content column. A change of marker (`-` to `1.`)
 * starts a new list.
 */
function listsFrom(lines: readonly string[], first: Item, isProvisional: boolean): MarkdownBlock[] {
  const items: { readonly line: Item; readonly lines: string[] }[] = [];
  for (const line of lines) {
    const kind = classifyMarkdownLine(line);
    const current = items.at(-1);
    if (kind.kind === 'item' && kind.indent <= first.indent) {
      items.push({ line: kind, lines: [kind.text] });
    } else {
      current?.lines.push(dedent(line, current.line.contentIndent));
    }
  }
  const lists: { readonly first: Item; readonly items: MarkdownBlock[][] }[] = [];
  for (const [index, item] of items.entries()) {
    const blocks = parseMarkdown(item.lines.join('\n'), {
      isProvisional: isProvisional && index === items.length - 1,
    });
    const list = lists.at(-1);
    if (list?.first.marker === item.line.marker) {
      list.items.push(blocks);
    } else {
      lists.push({ first: item.line, items: [blocks] });
    }
  }
  return lists.map(({ first: line, items: listItems }): MarkdownBlock => {
    return {
      kind: 'list',
      ...(line.start !== undefined && { start: line.start }),
      items: listItems,
    };
  });
}

/** A header row, a delimiter row with as many columns, then body rows; else `undefined`. */
function tableFrom(lines: readonly string[], isProvisional: boolean): MarkdownBlock | undefined {
  const [header, delimiter, ...rows] = lines;
  if (header === undefined || delimiter === undefined || !header.includes('|')) {
    return undefined;
  }
  const head = tableCellsFrom(header);
  const alignments = tableAlignmentsFrom(delimiter);
  if (alignments?.length !== head.length) {
    return undefined;
  }
  const cells = (row: string, isLast: boolean): MarkdownInline[][] => {
    const found = tableCellsFrom(row);
    return alignments.map((_alignment, column) => {
      return parseMarkdownInline(found[column] ?? '', { isProvisional: isProvisional && isLast });
    });
  };
  return {
    kind: 'table',
    alignments,
    head: head.map((cell) => parseMarkdownInline(cell)),
    rows: rows.map((row, index) => cells(row, index === rows.length - 1)),
  };
}

/** A paragraph's lines, trimmed and joined; a lone pipe row still streaming may become a table. */
function paragraphFrom(
  lines: readonly string[],
  isProvisional: boolean,
): MarkdownBlock | undefined {
  if (isProvisional && lines.length === 1 && lines[0]?.trimStart().startsWith('|') === true) {
    return undefined;
  }
  const text = lines.map((line) => line.trim()).join('\n');
  return { kind: 'paragraph', children: parseMarkdownInline(text, { isProvisional }) };
}
