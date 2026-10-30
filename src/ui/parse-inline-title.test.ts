import { describe, expect, it } from 'vitest';

import { parseInlineTitle } from './parse-inline-title.ts';

describe('parseInlineTitle', () => {
  it('turns inline code into a code span and keeps the rest as text', () => {
    expect(parseInlineTitle('An unknown coupon makes the total `NaN`')).toEqual([
      { kind: 'text', text: 'An unknown coupon makes the total ' },
      { kind: 'code', text: 'NaN' },
    ]);
  });

  it('parses bold and italics, and leaves an unclosed backtick literal', () => {
    expect(parseInlineTitle('**Bad** *call* to `split')).toEqual([
      { kind: 'strong', text: 'Bad' },
      { kind: 'text', text: ' ' },
      { kind: 'emphasis', text: 'call' },
      { kind: 'text', text: ' to `split' },
    ]);
  });

  it('flattens list and heading syntax so a title stays one line of inline spans', () => {
    expect(parseInlineTitle('- `a`  and\n`b`')).toEqual([
      { kind: 'code', text: 'a' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'b' },
    ]);
  });

  it('never yields markup: angle brackets stay text', () => {
    expect(parseInlineTitle('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});
