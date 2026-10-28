import { describe, expect, it } from 'vitest';

import { parseInsightMarkdown } from './parse-insight-markdown.ts';

describe('parseInsightMarkdown', () => {
  it('splits paragraphs and parses inline code, bold, italics and link text', () => {
    expect(
      parseInsightMarkdown(
        'A **bad** `split` call,\nsee [docs](https://x.test) and *why*.\n\nNext.',
      ),
    ).toEqual([
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

  it('parses lists with continuation lines, headings and fenced code', () => {
    expect(
      parseInsightMarkdown(
        '## Risk\nSteps:\n- empty `input`\n  reaches it\n1. second\n```ts\nconst a = 1;\n```',
      ),
    ).toEqual([
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

  it('keeps HTML and unclosed markup as literal text', () => {
    expect(parseInsightMarkdown('<img src=x onerror=alert(1)> **open')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: '<img src=x onerror=alert(1)> **open' }] },
    ]);
    expect(parseInsightMarkdown('```\nunterminated')).toEqual([
      { kind: 'code', text: 'unterminated' },
    ]);
  });
});
