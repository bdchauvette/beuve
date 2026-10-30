import { describe } from 'vitest';

import type { MarkdownBlock, MarkdownInline } from './markdown-tree.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { test } from './testing/test.ts';

function text(value: string): MarkdownInline {
  return { kind: 'text', text: value };
}

function paragraph(value: string): MarkdownBlock {
  return { kind: 'paragraph', children: [text(value)] };
}

describe('parseMarkdown', () => {
  test.for<[string, string, MarkdownBlock[]]>([
    [
      'paragraphs, joined lines',
      'one\n  two\n\nthree',
      [paragraph('one\ntwo'), paragraph('three')],
    ],
    [
      'ATX headings, closing hashes dropped',
      '# One\n### Three ###\n#hashtag',
      [
        { kind: 'heading', level: 1, children: [text('One')] },
        { kind: 'heading', level: 3, children: [text('Three')] },
        paragraph('#hashtag'),
      ],
    ],
    [
      'a fence keeps Markdown and blank lines literal',
      '```diff extra\n# a\n\n- b\n```\nafter',
      [{ kind: 'code', info: 'diff', text: '# a\n\n- b', closed: true }, paragraph('after')],
    ],
    [
      'a tilde fence closes only on tildes, at least as many',
      '~~~~\n```\n~~~\n~~~~~',
      [{ kind: 'code', info: '', text: '```\n~~~', closed: true }],
    ],
    [
      'an unclosed fence runs to the end',
      '```js\nlet a',
      [{ kind: 'code', info: 'js', text: 'let a', closed: false }],
    ],
    [
      'an indented fence is dedented',
      '  ```\n    two\n  one\n  ```',
      [{ kind: 'code', info: '', text: '  two\none', closed: true }],
    ],
    [
      'bullet lists, loose or tight, with nesting',
      '- a\n  - a.1\n    - a.1.1\n\n- b\n  more b',
      [
        {
          kind: 'list',
          items: [
            [
              paragraph('a'),
              {
                kind: 'list',
                items: [[paragraph('a.1'), { kind: 'list', items: [[paragraph('a.1.1')]] }]],
              },
            ],
            [paragraph('b\nmore b')],
          ],
        },
      ],
    ],
    [
      'ordered lists keep their start; a new marker starts a new list',
      '3. three\n4) four\n* star',
      [
        { kind: 'list', start: 3, items: [[paragraph('three')]] },
        { kind: 'list', start: 4, items: [[paragraph('four')]] },
        { kind: 'list', items: [[paragraph('star')]] },
      ],
    ],
    [
      'two-space nesting under an ordered item',
      '1. top\n  - child\n2. next',
      [
        {
          kind: 'list',
          start: 1,
          items: [
            [paragraph('top'), { kind: 'list', items: [[paragraph('child')]] }],
            [paragraph('next')],
          ],
        },
      ],
    ],
    [
      'a code fence inside a list item',
      '1. Run:\n   ```sh\n   npm test\n   ```\n2. Done',
      [
        {
          kind: 'list',
          start: 1,
          items: [
            [paragraph('Run:'), { kind: 'code', info: 'sh', text: 'npm test', closed: true }],
            [paragraph('Done')],
          ],
        },
      ],
    ],
    [
      'a list ends at an unindented paragraph',
      '- a\n\nafter',
      [{ kind: 'list', items: [[paragraph('a')]] }, paragraph('after')],
    ],
    [
      'a paragraph is interrupted by a list, a heading or a quote',
      'intro\n- a\n\nintro\n# h\nintro\n> q',
      [
        paragraph('intro'),
        { kind: 'list', items: [[paragraph('a')]] },
        paragraph('intro'),
        { kind: 'heading', level: 1, children: [text('h')] },
        paragraph('intro'),
        { kind: 'quote', children: [paragraph('q')] },
      ],
    ],
    [
      'block quotes nest and hold blocks',
      '> # T\n> > inner\n>\n> - item',
      [
        {
          kind: 'quote',
          children: [
            { kind: 'heading', level: 1, children: [text('T')] },
            { kind: 'quote', children: [paragraph('inner')] },
            { kind: 'list', items: [[paragraph('item')]] },
          ],
        },
      ],
    ],
    [
      'rules, but a lone dash line is an empty item',
      '---\n* * *\n___\n-',
      [{ kind: 'rule' }, { kind: 'rule' }, { kind: 'rule' }, { kind: 'list', items: [[]] }],
    ],
    [
      'GFM tables with alignment, padded and truncated rows',
      'a | b | c\n:-|:-:|-:\n1 | 2\n1 | 2 | 3 | 4\n\nafter',
      [
        {
          kind: 'table',
          alignments: ['left', 'center', 'right'],
          head: [[text('a')], [text('b')], [text('c')]],
          rows: [
            [[text('1')], [text('2')], []],
            [[text('1')], [text('2')], [text('3')]],
          ],
        },
        paragraph('after'),
      ],
    ],
    [
      'a pipe paragraph without a matching delimiter row is a paragraph',
      '| a | b |\n| --- |',
      [paragraph('| a | b |\n| --- |')],
    ],
    [
      'unsupported syntax stays text: setext, indented code, images',
      'Title\n===\n\n    indented\n\n![alt](https://example.com/a.png)',
      [
        paragraph('Title\n==='),
        paragraph('indented'),
        {
          kind: 'paragraph',
          children: [
            text('!'),
            { kind: 'link', href: 'https://example.com/a.png', children: [text('alt')] },
          ],
        },
      ],
    ],
    [
      'CRLF line breaks',
      '# A\r\n\r\nb\r\nc\r\n',
      [{ kind: 'heading', level: 1, children: [text('A')] }, paragraph('b\nc')],
    ],
  ])('%s', ([, source, expected], { expect }) => {
    expect(parseMarkdown(source)).toStrictEqual(expected);
  });

  test.for<[string, string, MarkdownBlock[]]>([
    [
      'raw HTML is text',
      '<div onclick="x()">hi</div>\n<script>alert(1)</script>',
      [paragraph('<div onclick="x()">hi</div>\n<script>alert(1)</script>')],
    ],
    [
      'HTML in a heading and a table cell is text',
      '# <b>x</b>\n\n| <i>a</i> |\n|-|',
      [
        { kind: 'heading', level: 1, children: [text('<b>x</b>')] },
        { kind: 'table', alignments: [undefined], head: [[text('<i>a</i>')]], rows: [] },
      ],
    ],
    [
      'a javascript: link keeps only its text',
      '[click](javascript:alert(1))',
      [paragraph('click')],
    ],
    ['a data: autolink stays text', '<data:text/html,hi>', [paragraph('<data:text/html,hi>')]],
    [
      'an entity-obfuscated scheme keeps only its text',
      '[x](jav&#97;script:alert(1))',
      [paragraph('x')],
    ],
  ])('safety: %s', ([, source, expected], { expect }) => {
    expect(parseMarkdown(source)).toStrictEqual(expected);
  });

  test.for<[string, string, MarkdownBlock[]]>([
    ['a lone heading marker waits', 'Done.\n#', [paragraph('Done.')]],
    ['a list marker waits', 'Done.\n- ', [paragraph('Done.')]],
    ['backticks that may open a fence wait', 'Done.\n``', [paragraph('Done.')]],
    ['a table header waits for its delimiter row', '| a | b |\n| -', []],
    [
      'a table shows once its delimiter row is there',
      '| a |\n|---|\n| 1',
      [{ kind: 'table', alignments: [undefined], head: [[text('a')]], rows: [[[text('1')]]] }],
    ],
    [
      'an open fence shows its code',
      '```ts\nlet a',
      [{ kind: 'code', info: 'ts', text: 'let a', closed: false }],
    ],
    [
      'an unfinished inline in the last list item',
      '- a\n- **b',
      [
        {
          kind: 'list',
          items: [
            [paragraph('a')],
            [{ kind: 'paragraph', children: [{ kind: 'strong', children: [text('b')] }] }],
          ],
        },
      ],
    ],
  ])('provisional: %s', ([, source, expected], { expect }) => {
    expect(parseMarkdown(source, { isProvisional: true })).toStrictEqual(expected);
  });
});
