import type { MarkdownBlock, MarkdownInline, TableAlignment } from './markdown-tree.ts';

/** How the app-specific parts of an answer become nodes. */
export interface MarkdownRenderers {
  /** A `[[…]]` line citation as written: a pill, a dimmed marker or plain text (ADR 0031). */
  readonly marker: (text: string) => Node;
  /** A fenced code block; `closed` is false while its closing fence is still to come. */
  readonly code: (block: CodeBlock) => Element;
}

/** A fenced code block of a parsed answer. */
export type CodeBlock = Extract<MarkdownBlock, { kind: 'code' }>;

type TableBlock = Extract<MarkdownBlock, { kind: 'table' }>;

/**
 * DOM nodes for parsed Markdown (ADR 0073), built with `createElement` and text nodes only: no
 * model text ever reaches `innerHTML` or an attribute other than a link's checked `href`. Links
 * carry `data-action="link"` for the owner's delegated click listener, which opens them through
 * main; they never navigate the window.
 */
export function createMarkdownNodes(
  blocks: readonly MarkdownBlock[],
  renderers: MarkdownRenderers,
): Element[] {
  return blocks.map((block) => blockNode(block, renderers));
}

function blockNode(block: MarkdownBlock, renderers: MarkdownRenderers): Element {
  switch (block.kind) {
    case 'paragraph': {
      return withInlines(document.createElement('p'), block.children, renderers);
    }
    case 'heading': {
      return withInlines(
        document.createElement(`h${String(block.level)}`),
        block.children,
        renderers,
      );
    }
    case 'code': {
      return renderers.code(block);
    }
    case 'list': {
      const list = listElement(block.start);
      for (const item of block.items) {
        const element = document.createElement('li');
        element.append(...createMarkdownNodes(item, renderers));
        list.append(element);
      }
      return list;
    }
    case 'quote': {
      const quote = document.createElement('blockquote');
      quote.append(...createMarkdownNodes(block.children, renderers));
      return quote;
    }
    case 'rule': {
      return document.createElement('hr');
    }
    case 'table': {
      return tableNode(block, renderers);
    }
  }
}

/** `<ul>` for a bullet list, `<ol>` numbered from `start` for an ordered one. */
function listElement(start: number | undefined): HTMLElement {
  if (start === undefined) {
    return document.createElement('ul');
  }
  const list = document.createElement('ol');
  if (start !== 1) {
    list.setAttribute('start', String(start));
  }
  return list;
}

function tableNode(block: TableBlock, renderers: MarkdownRenderers): Element {
  const row = (cells: readonly (readonly MarkdownInline[])[], tag: 'th' | 'td'): HTMLElement => {
    const element = document.createElement('tr');
    for (const [column, cell] of cells.entries()) {
      const item = withInlines(document.createElement(tag), cell, renderers);
      const alignment: TableAlignment = block.alignments[column];
      if (alignment !== undefined) {
        item.classList.add(`align-${alignment}`);
      }
      element.append(item);
    }
    return element;
  };
  const head = document.createElement('thead');
  head.append(row(block.head, 'th'));
  const body = document.createElement('tbody');
  body.append(...block.rows.map((cells) => row(cells, 'td')));
  const table = document.createElement('table');
  table.append(head, body);
  const scroller = document.createElement('div');
  scroller.className = 'table';
  scroller.append(table);
  return scroller;
}

function withInlines(
  element: HTMLElement,
  inlines: readonly MarkdownInline[],
  renderers: MarkdownRenderers,
): HTMLElement {
  element.append(...inlines.map((inline) => inlineNode(inline, renderers)));
  return element;
}

function inlineNode(inline: MarkdownInline, renderers: MarkdownRenderers): Node {
  switch (inline.kind) {
    case 'text': {
      return document.createTextNode(inline.text);
    }
    case 'code': {
      const code = document.createElement('code');
      code.textContent = inline.text;
      return code;
    }
    case 'strong': {
      return withInlines(document.createElement('strong'), inline.children, renderers);
    }
    case 'emphasis': {
      return withInlines(document.createElement('em'), inline.children, renderers);
    }
    case 'link': {
      const link = withInlines(document.createElement('a'), inline.children, renderers);
      link.setAttribute('href', inline.href);
      link.setAttribute('title', inline.href);
      link.setAttribute('rel', 'noreferrer');
      link.dataset['action'] = 'link';
      link.dataset['url'] = inline.href;
      return link;
    }
    case 'marker': {
      return renderers.marker(inline.text);
    }
  }
}
