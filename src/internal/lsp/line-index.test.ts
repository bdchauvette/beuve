import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { LineIndex } from './line-index.ts';

describe('LineIndex', () => {
  test('treats CRLF, LF and lone CR as line ends and excludes them from line text', ({
    expect,
  }) => {
    const index = new LineIndex('one\r\ntwo\nthree\rfour\r\n');
    expect(index.lineCount).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map((n) => index.lineText(n))).toStrictEqual([
      'one',
      'two',
      'three',
      'four',
      '',
      '',
    ]);
  });
});
