import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseInlineTitle } from './parse-inline-title.ts';

describe('parseInlineTitle', () => {
  test('turns inline code into a code span and keeps the rest as text', ({ expect }) => {
    expect(parseInlineTitle('An unknown coupon makes the total `NaN`')).toStrictEqual([
      { kind: 'text', text: 'An unknown coupon makes the total ' },
      { kind: 'code', text: 'NaN' },
    ]);
  });

  test('parses bold and italics, and leaves an unclosed backtick literal', ({ expect }) => {
    expect(parseInlineTitle('**Bad** *call* to `split')).toStrictEqual([
      { kind: 'strong', text: 'Bad' },
      { kind: 'text', text: ' ' },
      { kind: 'emphasis', text: 'call' },
      { kind: 'text', text: ' to `split' },
    ]);
  });

  test('flattens list and heading syntax so a title stays one line of inline spans', ({
    expect,
  }) => {
    expect(parseInlineTitle('- `a`  and\n`b`')).toStrictEqual([
      { kind: 'code', text: 'a' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'b' },
    ]);
  });

  test('never yields markup: angle brackets stay text', ({ expect }) => {
    expect(parseInlineTitle('<img src=x onerror=alert(1)>')).toStrictEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});
