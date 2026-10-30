import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseMarkdownSubset } from './parse-markdown-subset.ts';

describe('parseMarkdownSubset', () => {
  test('splits paragraphs and parses inline code, bold, italics and link text', ({ expect }) => {
    expect(
      parseMarkdownSubset(
        'A **bad** `split` call,\nsee [docs](https://x.test) and *why*.\n\nNext.',
      ),
    ).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'A ' },
          { kind: 'strong', text: 'bad' },
          { kind: 'text', text: ' ' },
          { kind: 'code', text: 'split' },
          { kind: 'text', text: ' call, see ' },
          { kind: 'text', text: 'docs' },
          { kind: 'text', text: ' and ' },
          { kind: 'emphasis', text: 'why' },
          { kind: 'text', text: '.' },
        ],
      },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Next.' }] },
    ]);
  });

  test('parses lists with continuation lines, headings and fenced code', ({ expect }) => {
    expect(
      parseMarkdownSubset(
        '## Risk\nSteps:\n- empty `input`\n  reaches it\n1. second\n```ts\nconst a = 1;\n```',
      ),
    ).toStrictEqual([
      { kind: 'paragraph', spans: [{ kind: 'strong', text: 'Risk' }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Steps:' }] },
      {
        kind: 'list',
        items: [
          [
            { kind: 'text', text: 'empty ' },
            { kind: 'code', text: 'input' },
            { kind: 'text', text: ' reaches it' },
          ],
          [{ kind: 'text', text: 'second' }],
        ],
      },
      { kind: 'code', text: 'const a = 1;' },
    ]);
  });

  test('keeps HTML and unclosed markup as literal text', ({ expect }) => {
    expect(parseMarkdownSubset('<img src=x onerror=alert(1)> **open')).toStrictEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: '<img src=x onerror=alert(1)> **open' }] },
    ]);
    expect(parseMarkdownSubset('```\nunterminated')).toStrictEqual([
      { kind: 'code', text: 'unterminated' },
    ]);
  });
});
