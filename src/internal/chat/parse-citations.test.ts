import { describe, expect, it } from 'vitest';

import { parseCitations } from './parse-citations.ts';
import type { CitationMarker } from './parse-citations.ts';

describe('parseCitations', () => {
  it('finds single lines and ranges with their offsets, in order', () => {
    const answer = 'It trims [[src/a.ts:12-13]] and then [[./src/b.ts:2]].';
    expect(parseCitations(answer)).toEqual({
      markers: [
        { index: 9, length: 18, path: 'src/a.ts', startLine: 12, endLine: 13 },
        { index: 37, length: 16, path: 'src/b.ts', startLine: 2, endLine: 2 },
      ],
      malformed: 0,
    });
  });

  it('takes the path up to the last colon', () => {
    expect(parseCitations('[[docs/a:b.md:3-4]]').markers).toEqual<CitationMarker[]>([
      { index: 0, length: 19, path: 'docs/a:b.md', startLine: 3, endLine: 4 },
    ]);
  });

  it('counts malformed markers and ignores unbracketed or multi-line text', () => {
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
    expect(parseCitations(answer)).toEqual({ markers: [], malformed: 8 });
  });

  it('keeps duplicates; the validator dedupes', () => {
    expect(parseCitations('[[a.ts:1]] [[a.ts:1-1]]').markers).toHaveLength(2);
  });
});
