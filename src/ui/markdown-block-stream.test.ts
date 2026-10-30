import { describe } from 'vitest';

import { MarkdownBlockStream } from './markdown-block-stream.ts';
import type { MarkdownChunk } from './markdown-block-stream.ts';
import type { MarkdownBlock } from './markdown-tree.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { sampleMarkdown } from './testing/sample-markdown.ts';
import { test } from './testing/test.ts';

/** Pipes `deltas` through the block stage and collects what it emits. */
async function streamed(deltas: readonly string[], signal: AbortSignal): Promise<MarkdownChunk[]> {
  const chunks: MarkdownChunk[] = [];
  await textStream(deltas)
    .pipeThrough(new MarkdownBlockStream())
    .pipeTo(
      new WritableStream({
        write: (chunk): void => {
          chunks.push(chunk);
        },
      }),
      { signal },
    );
  return chunks;
}

function textStream(deltas: readonly string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start: (controller): void => {
      for (const delta of deltas) {
        controller.enqueue(delta);
      }
      controller.close();
    },
  });
}

/** The finished blocks, in order, and the last tail's blocks. */
function rendered(chunks: readonly MarkdownChunk[]): {
  readonly blocks: MarkdownBlock[];
  readonly tail: readonly MarkdownBlock[] | undefined;
} {
  return {
    blocks: chunks.flatMap((chunk) => (chunk.kind === 'block' ? chunk.blocks : [])),
    tail: chunks.findLast((chunk) => chunk.kind === 'tail')?.blocks,
  };
}

/** `text` in pieces of `size` characters. */
function piecesOf(text: string, size: number): string[] {
  return Array.from({ length: Math.ceil(text.length / size) }, (_piece, index) =>
    text.slice(index * size, (index + 1) * size),
  );
}

describe('MarkdownBlockStream', () => {
  test('emits each finished block once and ends with the one-shot tree', async ({
    expect,
    signal,
  }) => {
    const chunks = await streamed(['# Title\n\nSome **bo', 'ld** text\n\n- a\n', '- b'], signal);
    expect(chunks.map((chunk) => [chunk.kind, chunk.source])).toStrictEqual([
      ['block', '# Title\n'],
      ['tail', 'Some **bo'],
      ['block', 'Some **bold** text\n'],
      ['tail', '- a\n'],
      ['tail', '- a\n- b'],
      ['block', '- a\n- b'],
      ['tail', ''],
    ]);
    expect(rendered(chunks)).toStrictEqual({
      blocks: parseMarkdown('# Title\n\nSome **bold** text\n\n- a\n- b'),
      tail: [],
    });
  });

  test('renders the provisional tail as what it is becoming', async ({ expect, signal }) => {
    const chunks = await streamed(
      ['Some **bold and `co', 'de` text\n```ts\nconst a = 1;\n'],
      signal,
    );
    const tails = chunks.flatMap((chunk) => (chunk.kind === 'tail' ? [chunk.blocks] : []));
    expect(tails[0]).toStrictEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Some ' },
          {
            kind: 'strong',
            children: [
              { kind: 'text', text: 'bold and ' },
              { kind: 'code', text: 'co' },
            ],
          },
        ],
      },
    ]);
    expect(tails[1]).toStrictEqual([
      { kind: 'code', info: 'ts', text: 'const a = 1;', closed: false },
    ]);
  });

  test.for([1, 2, 3, 7, 64])(
    'gives the one-shot tree when the sample arrives %i characters at a time',
    async (size, { expect, signal }) => {
      const source = sampleMarkdown();
      const chunks = await streamed(piecesOf(source, size), signal);
      expect(rendered(chunks)).toStrictEqual({ blocks: parseMarkdown(source), tail: [] });
    },
  );

  test('gives the one-shot tree wherever the sample is split in two', async ({
    expect,
    signal,
  }) => {
    const source = sampleMarkdown();
    const expected = { blocks: parseMarkdown(source), tail: [] };
    const results = await Promise.all(
      Array.from({ length: source.length + 1 }, async (_offset, offset) =>
        rendered(await streamed([source.slice(0, offset), source.slice(offset)], signal)),
      ),
    );
    expect(results.filter((result) => !isSameTree(result, expected))).toStrictEqual([]);
  });
});

function isSameTree(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
