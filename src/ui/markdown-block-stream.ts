import type { MarkdownBlock } from './markdown-tree.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { splitMarkdownBlocks } from './split-markdown-blocks.ts';

/**
 * What {@link MarkdownBlockStream} emits: a `block` is finished and never changes; the `tail` is
 * the provisional rest, replacing the previous tail (empty once the text ends).
 */
export type MarkdownChunk =
  | { readonly kind: 'block'; readonly source: string; readonly blocks: readonly MarkdownBlock[] }
  | { readonly kind: 'tail'; readonly source: string; readonly blocks: readonly MarkdownBlock[] };

/**
 * The block stage of the streaming Markdown renderer (ADR 0073): text deltas in, parsed blocks
 * out. Each finished top-level block is parsed once and emitted as a `block`; then the open rest
 * is parsed provisionally and emitted as the `tail` when it changed. When the text ends, the
 * rest is split as final, so the blocks emitted are exactly `parseMarkdown` of the whole text.
 */
export class MarkdownBlockStream extends TransformStream<string, MarkdownChunk> {
  constructor() {
    let rest = '';
    let shownTail = '';
    super({
      transform: (delta, controller): void => {
        const split = splitMarkdownBlocks(rest + delta, { isFinal: false });
        emitBlocks(controller, split.blocks);
        rest = split.rest;
        if (rest === shownTail && split.blocks.length === 0) {
          return;
        }

        shownTail = rest;
        controller.enqueue({
          kind: 'tail',
          source: rest,
          blocks: parseMarkdown(rest, { isProvisional: true }),
        });
      },
      flush: (controller): void => {
        emitBlocks(controller, splitMarkdownBlocks(rest, { isFinal: true }).blocks);
        rest = '';
        controller.enqueue({ kind: 'tail', source: '', blocks: [] });
      },
    });
  }
}

function emitBlocks(
  controller: TransformStreamDefaultController<MarkdownChunk>,
  blocks: readonly string[],
): void {
  for (const source of blocks) {
    controller.enqueue({ kind: 'block', source, blocks: parseMarkdown(source) });
  }
}
