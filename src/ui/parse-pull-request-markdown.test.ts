import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parsePullRequestMarkdown } from './parse-pull-request-markdown.ts';

describe('parsePullRequestMarkdown', () => {
  test('turns markdown and bare https links into link spans, keeping punctuation outside', ({
    expect,
  }) => {
    expect(
      parsePullRequestMarkdown(
        'Fixes [the bug](https://github.com/o/r/issues/1). See https://github.com/o/r/pull/2.',
      ),
    ).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'Fixes ' },
          { kind: 'link', text: 'the bug', href: 'https://github.com/o/r/issues/1' },
          { kind: 'text', text: '. See ' },
          {
            kind: 'link',
            text: 'https://github.com/o/r/pull/2',
            href: 'https://github.com/o/r/pull/2',
          },
          { kind: 'text', text: '.' },
        ],
      },
    ]);
  });

  test('keeps other schemes, code and emphasis-looking URLs safe', ({ expect }) => {
    expect(
      parsePullRequestMarkdown(
        '[x](javascript:void) and https://github.com/o/r_a_b\n\n```\nhttps://github.com/in/code\n```',
      ),
    ).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'x' },
          { kind: 'text', text: ' and ' },
          { kind: 'link', text: 'https://github.com/o/r_a_b', href: 'https://github.com/o/r_a_b' },
        ],
      },
      { kind: 'code', text: 'https://github.com/in/code' },
    ]);
  });

  test('lists, headings and code spans pass through', ({ expect }) => {
    expect(parsePullRequestMarkdown('## REQ-1\n- `a` works\n- **b** too')).toStrictEqual([
      { kind: 'paragraph', spans: [{ kind: 'strong', text: 'REQ-1' }] },
      {
        kind: 'list',
        items: [
          [
            { kind: 'code', text: 'a' },
            { kind: 'text', text: ' works' },
          ],
          [
            { kind: 'strong', text: 'b' },
            { kind: 'text', text: ' too' },
          ],
        ],
      },
    ]);
  });
});
