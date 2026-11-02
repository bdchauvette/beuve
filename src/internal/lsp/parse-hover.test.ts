import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseHover } from './parse-hover.ts';

describe('parseHover', () => {
  test('keeps Markdown and the range', ({ expect }) => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    expect(
      parseHover({ contents: { kind: 'markdown', value: '```ts\nconst a: 1\n```\nDocs' }, range }),
    ).toStrictEqual({ markdown: '```ts\nconst a: 1\n```\nDocs', range });
  });

  test('turns plain text and code-tagged strings into fenced blocks, clear of inner backticks', ({
    expect,
  }) => {
    expect(parseHover({ contents: { kind: 'plaintext', value: 'a ``` b' } })).toStrictEqual({
      markdown: '````\na ``` b\n````',
      range: undefined,
    });
    expect(parseHover({ contents: { language: 'ts', value: 'let x' } })?.markdown).toBe(
      '```ts\nlet x\n```',
    );
    expect(parseHover({ contents: { language: 'a b\n```', value: 'x' } })?.markdown).toBe(
      '```ab\nx\n```',
    );
  });

  test('joins an array of parts with a rule and drops malformed and blank ones', ({ expect }) => {
    expect(
      parseHover({
        contents: ['first', { language: 'ts', value: 'sig' }, '  ', 7, { value: 3 }, undefined],
      })?.markdown,
    ).toBe('first\n\n---\n\n```ts\nsig\n```');
  });

  test('has nothing for null, empty contents and other shapes', ({ expect }) => {
    for (const value of [
      JSON.parse('null'),
      {},
      { contents: '' },
      { contents: [] },
      { contents: { kind: 'unknown', value: 'x' } },
      'text',
    ]) {
      expect(parseHover(value)).toBeUndefined();
    }
  });

  test('ignores a malformed range', ({ expect }) => {
    const end = { line: 1, character: 5 };
    expect(
      parseHover({ contents: 'x', range: { start: { line: -1, character: 0 }, end } })?.range,
    ).toBeUndefined();
  });

  test('cuts long text without splitting a surrogate pair', ({ expect }) => {
    const text = `${'a'.repeat(16_383)}😀tail`;
    const cut = parseHover({ contents: text })?.markdown ?? '';
    expect(cut).toBe(`${'a'.repeat(16_383)}\n\n…`);
  });
});
