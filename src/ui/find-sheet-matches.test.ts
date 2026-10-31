import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { findSheetMatches } from './find-sheet-matches.ts';

describe('findSheetMatches', () => {
  test('finds every occurrence by line and column, smart-cased', ({ expect }) => {
    const text = 'const Token = token;\r\nreturn tokenize(TOKEN);\n';
    expect(findSheetMatches({ query: 'token', text })).toStrictEqual([
      { line: 1, start: 6, end: 11 },
      { line: 1, start: 14, end: 19 },
      { line: 2, start: 7, end: 12 },
      { line: 2, start: 16, end: 21 },
    ]);
    expect(findSheetMatches({ query: 'Token', text })).toStrictEqual([
      { line: 1, start: 6, end: 11 },
    ]);
  });

  test('does not overlap matches and finds nothing for an empty query', ({ expect }) => {
    expect(findSheetMatches({ query: 'aa', text: 'aaaa' })).toStrictEqual([
      { line: 1, start: 0, end: 2 },
      { line: 1, start: 2, end: 4 },
    ]);
    expect(findSheetMatches({ query: '', text: 'abc' })).toStrictEqual([]);
  });
});
