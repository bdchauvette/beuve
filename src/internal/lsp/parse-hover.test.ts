import { describe, expect, it } from 'vitest';

import { parseHover } from './parse-hover.ts';

describe('parseHover', () => {
  it('accepts markup content, marked strings and arrays of them', () => {
    expect(parseHover({ contents: { kind: 'plaintext', value: 'x' } })).toEqual({
      kind: 'plaintext',
      value: 'x',
      range: undefined,
    });
    expect(parseHover({ contents: ['a', { language: 'ts', value: 'let b' }] })).toEqual({
      kind: 'markdown',
      value: 'a\n\n```ts\nlet b\n```',
      range: undefined,
    });
  });

  it('treats null or empty hovers as no hover', () => {
    expect(parseHover(JSON.parse('null'))).toBeUndefined();
    expect(parseHover({ contents: [] })).toBeUndefined();
    expect(parseHover({ contents: { kind: 'markdown', value: '' } })).toBeUndefined();
  });
});
