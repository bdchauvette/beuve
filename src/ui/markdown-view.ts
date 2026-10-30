import { createMarkdownNodes } from './create-markdown-nodes.ts';
import type { MarkdownRenderers } from './create-markdown-nodes.ts';
import { MarkdownBlockStream } from './markdown-block-stream.ts';
import type { MarkdownChunk } from './markdown-block-stream.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { splitMarkdownBlocks } from './split-markdown-blocks.ts';

interface ShownBlock {
  readonly source: string;
  readonly nodes: readonly Element[];
}

/**
 * The sink of the streaming Markdown renderer (ADR 0073): one element whose children it owns.
 * `stream` pipes a text part's deltas through {@link MarkdownBlockStream}: a finished block is
 * rendered once and never touched again, and only the provisional tail is replaced as deltas
 * arrive. `show` renders a whole text (a stored answer) through the same parser, keeping the
 * nodes of blocks that are unchanged and cite nothing, so a streamed answer's highlighted code
 * isn't rebuilt when the validated text replaces it.
 */
export class MarkdownView {
  private readonly onChange: (() => void) | undefined;
  private blocks: ShownBlock[] = [];
  private tail: readonly Element[] = [];
  readonly element: HTMLElement;

  /** `onChange` runs after each streamed chunk is rendered (to keep the transcript scrolled). */
  constructor(element: HTMLElement, onChange?: () => void) {
    this.element = element;
    this.onChange = onChange;
  }

  private apply(chunk: MarkdownChunk, renderers: MarkdownRenderers): void {
    const nodes = createMarkdownNodes(chunk.blocks, renderers);
    if (chunk.kind === 'block') {
      const [tail] = this.tail;
      if (tail === undefined) {
        this.element.append(...nodes);
      } else {
        tail.before(...nodes);
      }
      this.blocks.push({ source: chunk.source, nodes });
      return;
    }
    for (const node of this.tail) {
      node.remove();
    }
    this.element.append(...nodes);
    this.tail = nodes;
  }

  /**
   * Shows `blocks`, removing the nodes it no longer has first so that kept ones, in order, are
   * never moved (moving an element disconnects it, and a highlighted block would render again).
   */
  private replaceWith(blocks: readonly ShownBlock[]): void {
    const nodes = blocks.flatMap((block) => block.nodes);
    const kept = new Set<Node>(nodes);
    const stale = [...this.element.childNodes].filter((child) => !kept.has(child));
    for (const child of stale) {
      child.remove();
    }
    let cursor = this.element.firstChild;
    for (const node of nodes) {
      if (node === cursor) {
        cursor = cursor.nextSibling;
      } else {
        this.element.insertBefore(node, cursor);
      }
    }
    this.blocks = [...blocks];
    this.tail = [];
  }

  /**
   * Renders `text` as it arrives until it ends, errors (a discarded part) or `signal` aborts;
   * never rejects. What was rendered stays.
   */
  async stream(
    text: ReadableStream<string>,
    renderers: MarkdownRenderers,
    signal: AbortSignal,
  ): Promise<void> {
    this.replaceWith([]);
    try {
      await text.pipeThrough(new MarkdownBlockStream(), { signal }).pipeTo(
        new WritableStream<MarkdownChunk>({
          write: (chunk): void => {
            if (signal.aborted) {
              return;
            }

            this.apply(chunk, renderers);
            this.onChange?.();
          },
        }),
        { signal },
      );
    } catch {
      // Aborted or discarded: the owner shows the stored text or drops the view.
    }
  }

  /** Renders a whole text at once, reusing the nodes of unchanged blocks without citations. */
  show(source: string, renderers: MarkdownRenderers): void {
    const kept = new Map(
      this.blocks
        .filter((block) => !block.source.includes('[['))
        .map((block) => [block.source, block] as const),
    );
    this.replaceWith(
      splitMarkdownBlocks(source, { isFinal: true }).blocks.map(
        (block): ShownBlock =>
          kept.get(block) ?? {
            source: block,
            nodes: createMarkdownNodes(parseMarkdown(block), renderers),
          },
      ),
    );
  }
}
