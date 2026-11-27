import { describe } from 'vitest';

import { linesTextFrom } from './lines-text-from.ts';
import { test } from './testing/test.ts';

describe('linesTextFrom', () => {
  test('reads inclusive lines without the final newline, keeping carriage returns', ({
    expect,
  }) => {
    expect(linesTextFrom('one\ntwo\nthree\n', { startLine: 2, endLine: 3 })).toBe('two\nthree');
    expect(linesTextFrom('one\ntwo', { startLine: 2, endLine: 2 })).toBe('two');
    expect(linesTextFrom('a\r\nb\r\n', { startLine: 1, endLine: 2 })).toBe('a\r\nb\r');
  });

  test('reads nothing for an insertion, and refuses lines past the end', ({ expect }) => {
    expect(linesTextFrom('one\n', { startLine: 2, endLine: 1 })).toBe('');
    expect(linesTextFrom('one\n', { startLine: 1, endLine: 2 })).toBeUndefined();
    expect(linesTextFrom('one\n', { startLine: 0, endLine: 1 })).toBeUndefined();
  });
});
