import { describe } from 'vitest';

import { parseCitations } from './parse-citations.ts';
import type { CitationMarker } from './parse-citations.ts';
import { test } from './testing/test.ts';

describe('parseCitations', () => {
  test('finds single lines and ranges with their offsets, in order', ({ expect }) => {
    const answer = 'It trims [[src/a.ts:12-13]] and then [[./src/b.ts:2]].';
    expect(parseCitations(answer)).toStrictEqual({
      markers: [
        { index: 9, length: 18, path: 'src/a.ts', startLine: 12, endLine: 13 },
        { index: 37, length: 16, path: 'src/b.ts', startLine: 2, endLine: 2 },
      ],
      malformed: 0,
    });
  });

  test('takes the path up to the last colon', ({ expect }) => {
    expect(parseCitations('[[docs/a:b.md:3-4]]').markers).toStrictEqual<CitationMarker[]>([
      { index: 0, length: 19, path: 'docs/a:b.md', startLine: 3, endLine: 4 },
    ]);
  });

  test('counts malformed markers and ignores unbracketed or multi-line text', ({ expect }) => {
    const answer = [
      '[[src/a.ts]]',
      '[[42]]',
      '[[a.ts:1-2-3]]',
      '[[src/a.ts:0]]',
      '[[src/a.ts:5-3]]',
      '[[:4]]',
      '[[ src/a.ts:4]]',
      '[[src/a.ts:x-y]]',
      '[src/a.ts:4]',
      '[[src/a.ts:\n4]]',
      '[[src/a.ts:4-5]',
    ].join('\n');
    expect(parseCitations(answer)).toStrictEqual({ markers: [], malformed: 8 });
  });

  test('keeps duplicates; the validator dedupes', ({ expect }) => {
    expect(parseCitations('[[a.ts:1]] [[a.ts:1-1]]').markers).toHaveLength(2);
  });
});
