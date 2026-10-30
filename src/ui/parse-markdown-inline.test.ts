import { describe } from 'vitest';

import type { MarkdownInline } from './markdown-tree.ts';
import { parseMarkdownInline } from './parse-markdown-inline.ts';
import { test } from './testing/test.ts';

function text(value: string): MarkdownInline {
  return { kind: 'text', text: value };
}

function strong(...children: MarkdownInline[]): MarkdownInline {
  return { kind: 'strong', children };
}

function emphasis(...children: MarkdownInline[]): MarkdownInline {
  return { kind: 'emphasis', children };
}

function link(href: string, ...children: MarkdownInline[]): MarkdownInline {
  return { kind: 'link', href, children };
}

/** Sources and their trees: emphasis, code, escapes, links, URLs, citations and HTML. */
function inlineCases(): [string, MarkdownInline[]][] {
  return [
    ['plain text', [text('plain text')]],
    ['**strong** and __strong__', [strong(text('strong')), text(' and '), strong(text('strong'))]],
    ['*em* and _em_', [emphasis(text('em')), text(' and '), emphasis(text('em'))]],
    ['***both***', [strong(emphasis(text('both')))]],
    ['**a *b* c**', [strong(text('a '), emphasis(text('b')), text(' c'))]],
    ['*a **b** c*', [emphasis(text('a '), strong(text('b')), text(' c'))]],
    ['snake_case_name and __init__', [text('snake_case_name and '), strong(text('init'))]],
    ['2 * 3 * 4 and a*', [text('2 * 3 * 4 and a*')]],
    ['**not closed', [text('**not closed')]],
    [
      '`a * b` and ``a ` b``',
      [{ kind: 'code', text: 'a * b' }, text(' and '), { kind: 'code', text: 'a ` b' }],
    ],
    ['` padded `', [{ kind: 'code', text: 'padded' }]],
    ['`unclosed', [text('`unclosed')]],
    ['\\*not em\\* and \\`', [text('*not em* and `')]],
    ['a \\ b', [text('a \\ b')]],
    ['[docs](https://example.com/a_b "Title")', [link('https://example.com/a_b', text('docs'))]],
    [
      '[**bold** `code`](http://localhost:3000)',
      [
        link('http://localhost:3000/', strong(text('bold')), text(' '), {
          kind: 'code',
          text: 'code',
        }),
      ],
    ],
    [
      '[a [nested] label](https://x.dev/(p))',
      [link('https://x.dev/(p)', text('a [nested] label'))],
    ],
    ['[relative](src/a.ts) and [ref][1]', [text('relative and [ref][1]')]],
    ['<https://x.dev/q?a=1>', [link('https://x.dev/q?a=1', text('https://x.dev/q?a=1'))]],
    [
      'see https://x.dev/a_b. Or (https://x.dev/c)',
      [
        text('see '),
        link('https://x.dev/a_b', text('https://x.dev/a_b')),
        text('. Or ('),
        link('https://x.dev/c', text('https://x.dev/c')),
        text(')'),
      ],
    ],
    ['xhttps://x.dev', [text('xhttps://x.dev')]],
    [
      'at [[src/a_b.ts:3-4]] and *[[c.ts:1-1]]*',
      [
        text('at '),
        { kind: 'marker', text: '[[src/a_b.ts:3-4]]' },
        text(' and '),
        emphasis({ kind: 'marker', text: '[[c.ts:1-1]]' }),
      ],
    ],
    [
      '_a [[x_y.ts:1-2]] b_',
      [emphasis(text('a '), { kind: 'marker', text: '[[x_y.ts:1-2]]' }, text(' b'))],
    ],
    ['`[[a.ts:1-2]]`', [{ kind: 'code', text: '[[a.ts:1-2]]' }]],
    [
      '<b>bold</b> &amp; <img src=x onerror=alert(1)>',
      [text('<b>bold</b> &amp; <img src=x onerror=alert(1)>')],
    ],
  ];
}

describe('parseMarkdownInline', () => {
  test.for(inlineCases())('%s', ([source, expected], { expect }) => {
    expect(parseMarkdownInline(source)).toStrictEqual(expected);
  });

  test.for<[string, MarkdownInline[]]>([
    ['[x](javascript:alert(1))', [text('x')]],
    ['[x](JavaScript:alert(1))', [text('x')]],
    ['[x]( javascript:alert(1) )', [text('x')]],
    ['[x](vbscript:msgbox(1))', [text('x')]],
    ['[x](data:text/html;base64,PHNjcmlwdD4=)', [text('x')]],
    ['[x](file:///etc/passwd)', [text('x')]],
    ['[x](//evil.example/)', [text('x')]],
    ['<javascript:alert(1)>', [text('<javascript:alert(1)>')]],
    ['javascript:alert(1)', [text('javascript:alert(1)')]],
  ])('safety: %s has no link', ([source, expected], { expect }) => {
    expect(parseMarkdownInline(source)).toStrictEqual(expected);
  });

  test.for<[string, MarkdownInline[]]>([
    ['Some **bold', [text('Some '), strong(text('bold'))]],
    ['Some **', [text('Some ')]],
    ['a *em', [text('a '), emphasis(text('em'))]],
    ['2*3', [text('2*3')]],
    ['run `npm t', [text('run '), { kind: 'code', text: 'npm t' }]],
    ['run `', [text('run ')]],
    ['see [the docs](https://exa', [text('see the docs')]],
    ['see [the do', [text('see the do')]],
    ['see [the docs]', [text('see the docs')]],
    ['at [[src/a.ts:1', [text('at ')]],
    ['at [[src/a.ts:1-2]', [text('at ')]],
    ['ends with \\', [text('ends with ')]],
    ['closed **b** stays', [text('closed '), strong(text('b')), text(' stays')]],
  ])('provisional: %s', ([source, expected], { expect }) => {
    expect(parseMarkdownInline(source, { isProvisional: true })).toStrictEqual(expected);
  });
});
