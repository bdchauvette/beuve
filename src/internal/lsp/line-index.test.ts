import { describe, expect, it } from 'vitest';

import { LineIndex } from './line-index.ts';

describe('LineIndex', () => {
  it('treats CRLF, LF and lone CR as line ends and excludes them from line text', () => {
    const index = new LineIndex('one\r\ntwo\nthree\rfour\r\n');
    expect(index.lineCount).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map((n) => index.lineText(n))).toEqual([
      'one',
      'two',
      'three',
      'four',
      '',
      '',
    ]);
  });
});
