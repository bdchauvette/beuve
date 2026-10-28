import { describe, expect, it } from 'vitest';

import { parsePullRequestMarkdown } from './parse-pull-request-markdown.ts';

describe('parsePullRequestMarkdown', () => {
  it('turns markdown and bare https links into link spans, keeping punctuation outside', () => {
    expect(
      parsePullRequestMarkdown(
        'Fixes [the bug](https://github.com/o/r/issues/1). See https://github.com/o/r/pull/2.',
      ),
    ).toEqual([
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

  it('keeps other schemes, code and emphasis-looking URLs safe', () => {
    expect(
      parsePullRequestMarkdown(
        '[x](javascript:void) and https://github.com/o/r_a_b\n\n```\nhttps://github.com/in/code\n```',
      ),
    ).toEqual([
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

  it('lists, headings and code spans pass through', () => {
    expect(parsePullRequestMarkdown('## REQ-1\n- `a` works\n- **b** too')).toEqual([
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
